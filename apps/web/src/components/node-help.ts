/**
 * What each step of the pipeline is for, in the owner's terms. The pipeline
 * definition names roles and edges — what the engine needs — and says nothing
 * about why a person should care that `spec_review` exists. This is that, and
 * it lives here because it is interface copy, not a property of the graph.
 *
 * A node with no entry gets no tooltip rather than a generic one: a hint that
 * says nothing is worse than no hint, because it teaches the owner that
 * hovering is not worth doing.
 */
export const NODE_HELP: Record<string, string> = {
  planning:
    'Reads the repository and turns the request into a brief: what it takes to be true, what it will not touch, how big it is, and anything it needs you to decide.',
  human_kickoff_gate:
    'Yours. Approve the brief to let the work start, or send it back to be planned again — this is the cheapest point at which to change your mind.',
  specify:
    'Continues the planning session into a written spec: the requirements and the scenarios that will be used to judge whether the work is done.',
  spec_review:
    'A second model, deliberately not the one that wrote the spec, reads it for gaps and contradictions and sends it back until it holds.',
  human_spec_gate:
    'Yours. Approve the spec to start implementation, or send it back to be rewritten. Nothing is coded until you pass this.',
  implement: 'Writes the code against the approved spec, and commits it.',
  validate:
    'A second model proves the change against the spec and judges it, sending the work back when it does not hold up.',
  summarize: 'Writes the account of what changed and why, for the pull request and for you.',
  human_final_gate:
    'Yours. Approve to publish the branch as a pull request, or send the work back to implementation or to the spec.',
  publish: 'Pushes the branch and opens the pull request.',
}
