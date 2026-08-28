/**
 * Shared render helper for the component suites.
 *
 * Components are rendered for real and driven through the DOM, so an assertion
 * about "pressing Enter sends" exercises the same path a person's keystroke
 * takes. CSS modules resolve to identity-mapped objects under vitest, so class
 * assertions check the intent (`styles.blocked`) rather than a hashed name.
 * @module @mrpl/dsh-workbench-ui/tests/render
 */

import { cleanup, render as rtlRender } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ReactElement } from 'react'

afterEach(() => cleanup())

export { screen, fireEvent, waitFor, within } from '@testing-library/react'

/** Render one element into a fresh container. */
export function render(ui: ReactElement) {
  return rtlRender(ui)
}
