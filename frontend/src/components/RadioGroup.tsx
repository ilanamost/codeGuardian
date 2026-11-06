type Option<T extends string> = { value: T; label: string; description?: string }

type Props<T extends string> = {
  legend: string
  name: string
  optionList: Option<T>[]
  value: T
  onChange: (value: T) => void
}

export default function RadioGroup<T extends string>({ legend, name, optionList, value, onChange }: Props<T>) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-col gap-2">
        {optionList.map((option) => (
          <label key={option.value} className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1 accent-primary"
            />
            <span>
              {option.label}
              {option.description && <span className="block text-xs text-text-muted">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
