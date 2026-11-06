import { Check, X } from 'lucide-react'
import { passwordRuleCheck, type PasswordOwner, type PasswordRuleId } from '../lib/password-rule'
import { PASSWORD_RULE_LABEL, SESSION_TEXT } from '../lib/session.constants'

type Props = {
  id: string
  password: string
  owner: PasswordOwner
}

// The live checklist of the password rules (plan 028, Open Question 7): each line turns green as
// soon as the typed password passes that rule.
export default function PasswordChecklist({ id, password, owner }: Props) {
  const check = passwordRuleCheck(password, owner)

  return (
    <div id={id} className="flex flex-col gap-1">
      <p className="text-xs text-text-muted">{SESSION_TEXT.passwordRuleHeading}</p>
      <ul aria-label={SESSION_TEXT.passwordRuleHeading} className="flex flex-col gap-1">
        {(Object.keys(PASSWORD_RULE_LABEL) as PasswordRuleId[]).map((rule) => {
          const met = check[rule]
          const Icon = met ? Check : X
          return (
            <li key={rule} data-rule={rule} data-met={met} className={`flex items-center gap-2 text-xs ${met ? 'text-success' : 'text-text-muted'}`}>
              <Icon size={14} aria-hidden="true" />
              <span>
                {PASSWORD_RULE_LABEL[rule]}
                <span className="sr-only">: {met ? SESSION_TEXT.ruleMet : SESSION_TEXT.ruleNotMet}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
