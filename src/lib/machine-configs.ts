// Machine type configurations with fallback order
// C4 requires hyperdisk-balanced, C3/N2 use pd-ssd
// This file can be imported from both client and server components

export interface MachineConfig {
  machineType: string;
  diskType: string;
  displayName: string;
  vCPU: number;
  memoryGB: number;
}

export const MACHINE_CONFIGS: MachineConfig[] = [
  { machineType: "c4-standard-8", diskType: "hyperdisk-balanced", displayName: "C4-Standard-8", vCPU: 8, memoryGB: 30 },
  { machineType: "c3-standard-8", diskType: "pd-ssd", displayName: "C3-Standard-8", vCPU: 8, memoryGB: 32 },
  { machineType: "n2-standard-8", diskType: "pd-ssd", displayName: "N2-Standard-8", vCPU: 8, memoryGB: 32 },
  { machineType: "n2-standard-4", diskType: "pd-ssd", displayName: "N2-Standard-4", vCPU: 4, memoryGB: 16 },
];

// Default machine type
export const DEFAULT_MACHINE_TYPE = MACHINE_CONFIGS[0].machineType;

