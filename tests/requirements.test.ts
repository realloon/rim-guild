import { describe, expect, test } from 'bun:test'
import {
  requirementInputError,
  type RequirementFields,
} from '../src/lib/requirements'

const validFields: RequirementFields = {
  requirementTypes: ['artist', 'writer'],
  requirementDescriptions: ['绘制贴图', '润色文案'],
  requirementCounts: [1, 2],
}

describe('requirementInputError', () => {
  test('accepts a complete set of unique requirements', () => {
    expect(requirementInputError(validFields)).toBeUndefined()
  })

  test('requires at least one requirement', () => {
    expect(
      requirementInputError({
        requirementTypes: [],
        requirementDescriptions: [],
        requirementCounts: [],
      }),
    ).toBe('请至少添加一项需求')
  })

  test('rejects mismatched field arrays', () => {
    expect(
      requirementInputError({
        ...validFields,
        requirementCounts: [1],
      }),
    ).toBe('需求类型、要求与人数不匹配')
  })

  test('rejects duplicate requirement types', () => {
    expect(
      requirementInputError({
        ...validFields,
        requirementTypes: ['artist', 'artist'],
      }),
    ).toBe('同一种需求类型只能添加一次')
  })
})
