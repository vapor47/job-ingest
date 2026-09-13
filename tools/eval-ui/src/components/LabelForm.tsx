import { SENIORITY, LOCATION_POLICY, EMPLOYMENT_TYPE, JOB_FUNCTION } from "../../../../src/schema/job-posting.ts";
import { NullableSelect } from "./NullableSelect.tsx";
import { EnumCheckboxes } from "./EnumCheckboxes.tsx";
import { LocationInput } from "./LocationInput.tsx";
import { TitleInput } from "./TitleInput.tsx";
import { StackInput } from "./StackInput.tsx";
import { TagInput } from "./TagInput.tsx";
import type { PoolRecord } from "../types.ts";

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY", "INR", "SGD", "NZD"];

function NumberField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

export function LabelForm({ record, onChange }: { record: PoolRecord; onChange: (patch: Partial<PoolRecord>) => void }) {
  const isOtherCurrency = record.compCurrency !== null && !COMMON_CURRENCIES.includes(record.compCurrency);

  return (
    <div className="label-form">
      <label>
        Title
        <input value={record.title} onChange={(e) => onChange({ title: e.target.value })} />
      </label>

      <label>
        Canonical title
        <TitleInput value={record.titleCanonical} onChange={(v) => onChange({ titleCanonical: v })} />
      </label>

      <label>
        Job function
        <NullableSelect value={record.jobFunction} options={JOB_FUNCTION} onChange={(v) => onChange({ jobFunction: v as PoolRecord["jobFunction"] })} />
      </label>

      <label>
        Seniority
        <EnumCheckboxes value={record.seniority} options={SENIORITY} onChange={(v) => onChange({ seniority: v as PoolRecord["seniority"] })} />
      </label>

      <label>
        Location policy
        <EnumCheckboxes value={record.locationPolicy} options={LOCATION_POLICY} onChange={(v) => onChange({ locationPolicy: v as PoolRecord["locationPolicy"] })} />
      </label>

      <label>
        Location(s)
        <LocationInput value={record.locationGeo} onChange={(v) => onChange({ locationGeo: v })} />
      </label>

      <div className="field-row">
        <label>
          Comp min
          <NumberField value={record.compMin} onChange={(v) => onChange({ compMin: v })} />
        </label>
        <label>
          Comp max
          <NumberField value={record.compMax} onChange={(v) => onChange({ compMax: v })} />
        </label>
      </div>

      <label>
        Comp currency
        <select
          value={isOtherCurrency ? "__other__" : (record.compCurrency ?? "")}
          onChange={(e) => onChange({ compCurrency: e.target.value === "__other__" ? "" : e.target.value === "" ? null : e.target.value })}
        >
          <option value="">— Not stated —</option>
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__other__">Other…</option>
        </select>
        {isOtherCurrency && (
          <input
            value={record.compCurrency ?? ""}
            placeholder="currency code"
            onChange={(e) => onChange({ compCurrency: e.target.value })}
          />
        )}
      </label>

      <label>
        Stack
        <StackInput value={record.stack} onChange={(v) => onChange({ stack: v })} />
      </label>

      <label>
        Employment type
        <NullableSelect
          value={record.employmentType}
          options={EMPLOYMENT_TYPE}
          onChange={(v) => onChange({ employmentType: v as PoolRecord["employmentType"] })}
        />
      </label>

      <label>
        Flags
        <TagInput value={record.flags ?? []} onChange={(v) => onChange({ flags: v })} />
      </label>
    </div>
  );
}
