import { SENIORITY, LOCATION_POLICY, EMPLOYMENT_TYPE, STACK_VOCAB } from "../../../../src/schema/job-posting.ts";
import { NullableSelect } from "./NullableSelect.tsx";
import { MultiSelect } from "./MultiSelect.tsx";
import { LocationInput } from "./LocationInput.tsx";
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
        Seniority
        <NullableSelect value={record.seniority} options={SENIORITY} onChange={(v) => onChange({ seniority: v as PoolRecord["seniority"] })} />
      </label>

      <label>
        Location policy
        <NullableSelect
          value={record.locationPolicy}
          options={LOCATION_POLICY}
          onChange={(v) => onChange({ locationPolicy: v as PoolRecord["locationPolicy"] })}
        />
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
        Sponsorship
        <select
          value={record.sponsorship === null ? "" : String(record.sponsorship)}
          onChange={(e) => onChange({ sponsorship: e.target.value === "" ? null : e.target.value === "true" })}
        >
          <option value="">Not stated</option>
          <option value="true">Sponsors</option>
          <option value="false">Does not sponsor</option>
        </select>
      </label>

      <label>
        Stack
        <MultiSelect value={record.stack} options={STACK_VOCAB} onChange={(v) => onChange({ stack: v as PoolRecord["stack"] })} />
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
