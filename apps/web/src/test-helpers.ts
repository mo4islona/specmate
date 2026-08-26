import { screen } from '@testing-library/react'

/**
 * What a rendered diff line says: its sign and its code, without the gutter
 * that numbers it. A changed line is drawn as its sign and then its code in two
 * elements, so that the sign can keep the colour of the side it is on while the
 * code takes the colours of the language it is in — which means `-gone` is no
 * longer text anybody can query for.
 */
function lineText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => !(node instanceof Element) || !node.classList.contains('diff-gutter'))
    .map((node) => node.textContent ?? '')
    .join('')
}

function isLine(text: string) {
  return (_: string, element: Element | null): boolean => {
    if (!element?.classList.contains('diff-line')) return false

    return lineText(element) === text
  }
}

/** One line of a rendered diff, found by everything on it but its number. */
export function diffLine(text: string): HTMLElement {
  return screen.getByText(isLine(text))
}

export function findDiffLine(text: string): Promise<HTMLElement> {
  return screen.findByText(isLine(text))
}

export function queryDiffLine(text: string): HTMLElement | null {
  return screen.queryByText(isLine(text))
}
