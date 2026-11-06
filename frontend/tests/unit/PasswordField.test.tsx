import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import PasswordField from '../../src/components/PasswordField'

// Plan 029 revision 2: a password field is empty on load and is not autofilled by the browser.
function Field({ readOnly = false }: { readOnly?: boolean }) {
  const [value, setValue] = useState('')
  return <PasswordField label="Password" value={value} onChange={setValue} autoComplete="current-password" readOnly={readOnly} />
}

const input = () => screen.getByLabelText('Password', { selector: 'input' })

describe('PasswordField', () => {
  it('starts empty and read-only, so the browser cannot autofill it on load', () => {
    render(<Field />)
    expect(input()).toHaveValue('')
    expect(input()).toHaveAttribute('readonly')
    expect(input()).toHaveAttribute('autocomplete', 'current-password')
  })

  it('becomes editable when the user clicks it and takes the typed password', async () => {
    const user = userEvent.setup()
    render(<Field />)
    await user.click(input())
    expect(input()).not.toHaveAttribute('readonly')
    await user.type(input(), 'secret-42')
    expect(input()).toHaveValue('secret-42')
  })

  it('becomes editable on keyboard focus', () => {
    render(<Field />)
    fireEvent.focus(input())
    expect(input()).not.toHaveAttribute('readonly')
  })

  it('stays read-only when the caller asks for it, even after focus', () => {
    render(<Field readOnly />)
    fireEvent.focus(input())
    expect(input()).toHaveAttribute('readonly')
  })
})
