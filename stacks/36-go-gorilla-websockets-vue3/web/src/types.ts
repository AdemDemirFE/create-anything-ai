// Shared types for the four-screen contract.
export interface UserView {
  email: string
}

export interface Metric {
  label: string
  value: string
  unit: string
}

export interface HomeData {
  email: string
  metrics: Metric[]
  server_time: string
}

export interface AlgorithmEntry {
  id: string
  name: string
  complexity: string
  explanation: string
}

export interface RunResult {
  algorithm_id: string
  output: string
  execution_ms: number
  complexity: string
  explanation: string
}
