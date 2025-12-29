"""
Cleanup Function for Teable Dev Environments

This Cloud Function runs hourly and STOPS (not deletes) dev environments
that have been inactive (no SSH connections) for more than 12 hours.

Stop = Create snapshot + Delete instance (saves money, preserves data)
"""

import os
import json
from datetime import datetime, timezone, timedelta
from google.cloud import compute_v1
import functions_framework

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "teable-666")
ZONE = os.environ.get("GCP_ZONE", "asia-east2-a")
IDLE_TIMEOUT_HOURS = int(os.environ.get("IDLE_TIMEOUT_HOURS", "12"))


def get_instances_client():
    return compute_v1.InstancesClient()


def get_snapshots_client():
    return compute_v1.SnapshotsClient()


def get_dev_environments():
    """List all dev environment instances."""
    client = get_instances_client()
    
    request = compute_v1.ListInstancesRequest(
        project=PROJECT_ID,
        zone=ZONE,
        filter='labels.purpose="dev-env"',
    )
    
    instances = []
    for instance in client.list(request=request):
        instances.append(instance)
    
    return instances


def get_metadata_value(instance, key):
    """Get a metadata value from an instance."""
    if not instance.metadata or not instance.metadata.items:
        return None
    
    for item in instance.metadata.items:
        if item.key == key:
            return item.value
    return None


def should_delete_instance(instance):
    """
    Determine if an instance should be deleted based on last activity.
    
    An instance should be deleted if:
    - It has been more than IDLE_TIMEOUT_HOURS since last-active-at
    - OR if last-active-at is not set and created-at is old enough
    """
    now = datetime.now(timezone.utc)
    
    # Get last active time
    last_active_str = get_metadata_value(instance, "last-active-at")
    created_at_str = get_metadata_value(instance, "created-at")
    
    if last_active_str:
        try:
            last_active = datetime.fromisoformat(last_active_str.replace("Z", "+00:00"))
            idle_time = now - last_active
            if idle_time > timedelta(hours=IDLE_TIMEOUT_HOURS):
                return True, f"Idle for {idle_time.total_seconds() / 3600:.1f} hours"
        except ValueError:
            pass
    
    # Fallback to created-at if last-active-at is not available
    if created_at_str:
        try:
            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            age = now - created_at
            # If no activity tracking and older than timeout, delete
            if not last_active_str and age > timedelta(hours=IDLE_TIMEOUT_HOURS):
                return True, f"No activity tracking, age: {age.total_seconds() / 3600:.1f} hours"
        except ValueError:
            pass
    
    return False, "Still active"


def get_snapshot_name(username):
    """Get snapshot name for a user."""
    sanitized = username.lower().replace("@", "-").replace(".", "-")
    sanitized = ''.join(c if c.isalnum() or c == '-' else '-' for c in sanitized)
    return f"dev-snapshot-{sanitized}"


def stop_instance(instance_name, username):
    """
    Stop an instance by creating a snapshot and then deleting the instance.
    This preserves user data while reducing costs.
    """
    instances_client = get_instances_client()
    snapshots_client = get_snapshots_client()
    snapshot_name = get_snapshot_name(username)
    
    try:
        # Delete old snapshot if exists
        try:
            print(f"  Deleting old snapshot {snapshot_name}...")
            operation = snapshots_client.delete(
                project=PROJECT_ID,
                snapshot=snapshot_name,
            )
            wait_for_global_operation(operation.name)
        except Exception as e:
            # Ignore if snapshot doesn't exist
            if "404" not in str(e) and "NOT_FOUND" not in str(e):
                print(f"  Warning: Error deleting old snapshot: {e}")
        
        # Create new snapshot
        print(f"  Creating snapshot {snapshot_name}...")
        snapshot = compute_v1.Snapshot()
        snapshot.name = snapshot_name
        snapshot.source_disk = f"projects/{PROJECT_ID}/zones/{ZONE}/disks/{instance_name}"
        snapshot.description = f"Auto-saved snapshot for {username}'s dev environment"
        snapshot.labels = {
            "purpose": "dev-env-snapshot",
            "user": username.lower().replace("@", "-").replace(".", "-")[:63],
        }
        
        operation = snapshots_client.insert(
            project=PROJECT_ID,
            snapshot_resource=snapshot,
        )
        wait_for_global_operation(operation.name)
        print(f"  Snapshot {snapshot_name} created")
        
        # Delete the instance
        print(f"  Deleting instance {instance_name}...")
        operation = instances_client.delete(
            project=PROJECT_ID,
            zone=ZONE,
            instance=instance_name,
        )
        wait_for_zone_operation(operation.name)
        print(f"  Instance {instance_name} deleted")
        
        return True
    except Exception as e:
        print(f"Error stopping instance {instance_name}: {e}")
        return False


def wait_for_zone_operation(operation_name):
    """Wait for a zone operation to complete."""
    operations_client = compute_v1.ZoneOperationsClient()
    
    while True:
        result = operations_client.get(
            project=PROJECT_ID,
            zone=ZONE,
            operation=operation_name,
        )
        
        if result.status == compute_v1.Operation.Status.DONE:
            if result.error:
                raise Exception(f"Operation failed: {result.error}")
            return result
        
        import time
        time.sleep(2)


def wait_for_global_operation(operation_name):
    """Wait for a global operation to complete."""
    operations_client = compute_v1.GlobalOperationsClient()
    
    while True:
        result = operations_client.get(
            project=PROJECT_ID,
            operation=operation_name,
        )
        
        if result.status == compute_v1.Operation.Status.DONE:
            if result.error:
                raise Exception(f"Operation failed: {result.error}")
            return result
        
        import time
        time.sleep(2)


@functions_framework.http
def cleanup_handler(request):
    """
    HTTP handler for the cleanup function.
    
    This is triggered by Cloud Scheduler every hour.
    Stops (snapshot + delete) idle environments instead of destroying them.
    """
    print(f"Starting cleanup at {datetime.now(timezone.utc).isoformat()}")
    print(f"Project: {PROJECT_ID}, Zone: {ZONE}")
    print(f"Idle timeout: {IDLE_TIMEOUT_HOURS} hours")
    
    instances = get_dev_environments()
    print(f"Found {len(instances)} dev environment(s)")
    
    stopped = []
    kept = []
    
    for instance in instances:
        should_stop, reason = should_delete_instance(instance)
        username = get_metadata_value(instance, "username") or "unknown"
        
        if should_stop:
            print(f"Stopping {instance.name} (user: {username}): {reason}")
            if stop_instance(instance.name, username):
                stopped.append({
                    "name": instance.name,
                    "username": username,
                    "reason": reason,
                })
        else:
            print(f"Keeping {instance.name} (user: {username}): {reason}")
            kept.append({
                "name": instance.name,
                "username": username,
                "reason": reason,
            })
    
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stopped": stopped,
        "kept": kept,
        "summary": f"Stopped {len(stopped)}, kept {len(kept)} environment(s)",
    }
    
    print(f"Cleanup complete: {result['summary']}")
    
    return json.dumps(result), 200, {"Content-Type": "application/json"}


@functions_framework.cloud_event
def cleanup_pubsub(cloud_event):
    """
    Pub/Sub handler for the cleanup function.
    
    Alternative trigger method using Pub/Sub.
    """
    # Just call the same logic
    cleanup_handler(None)

