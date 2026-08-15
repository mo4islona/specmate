export interface DeclaredToolchain {
  readonly name: string
  readonly version?: string
}

export interface ResolvedToolchain {
  readonly name: string
  readonly version: string
}

export interface ExecutionEnvironment {
  readonly image: string
  readonly toolchains: readonly ResolvedToolchain[]
}
