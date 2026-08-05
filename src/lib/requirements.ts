import type { RequirementType } from './commissions'

export interface RequirementInput {
  type: RequirementType
  description: string
  count: number
}

export interface RequirementFields {
  requirementTypes: RequirementType[]
  requirementDescriptions: string[]
  requirementCounts: number[]
}

export function requirementInputError({
  requirementTypes,
  requirementDescriptions,
  requirementCounts,
}: RequirementFields): string | undefined {
  if (requirementTypes.length === 0) {
    return '请至少添加一项需求'
  }
  if (
    requirementTypes.length !== requirementDescriptions.length ||
    requirementTypes.length !== requirementCounts.length
  ) {
    return '需求类型、要求与人数不匹配'
  }
  if (new Set(requirementTypes).size !== requirementTypes.length) {
    return '同一种需求类型只能添加一次'
  }
}

