/**
 * A catalog whose only definition carries a forward loop edge. Importing this
 * module is the test: the load-time validation must throw naming the edge.
 */
import { loadPipelineCatalog, type PipelineDefinition } from '../../src/pipeline.ts'

const BROKEN: PipelineDefinition = {
  id: 'broken-forward-loop',
  terminal: 'archived',
  nodes: [
    { kind: 'stage', key: 'research', role: 'researcher', binding: 'role_default' },
    {
      kind: 'stage',
      key: 'implement',
      role: 'implementer',
      binding: 'role_default',
      loopEdge: { target: 'code_review', loop: 'impl' },
    },
    { kind: 'stage', key: 'code_review', role: 'reviewer', binding: 'cross_review' },
  ],
}

export const CATALOG = loadPipelineCatalog({ broken: BROKEN })
