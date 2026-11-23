"use client";
export const emptyAddress = { name: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" };
export type Address = typeof emptyAddress;

export function AddressForm({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const f = (k: keyof Address, label: string, cls = "") => (
    <div className={cls}>
      <label className="label" htmlFor={`addr-${k}`}>
        {label}
      </label>
      <input id={`addr-${k}`} className="input" value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} autoComplete={k === "line1" ? "address-line1" : k === "postalCode" ? "postal-code" : undefined} />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {f("name", "Full name", "col-span-2")}
      {f("line1", "Address", "col-span-2")}
      {f("line2", "Apt, suite (optional)", "col-span-2")}
      {f("city", "City")}
      {f("region", "State")}
      {f("postalCode", "ZIP")}
      <div>
        <label className="label" htmlFor="addr-country">
          Country
        </label>
        <select id="addr-country" className="input" value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })}>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="GB">United Kingdom</option>
        </select>
      </div>
    </div>
  );
}
