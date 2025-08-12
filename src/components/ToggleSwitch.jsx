// /src/components/ToggleSwitch.jsx
import React from "react";

export default function ToggleSwitch({
  checked = false,
  onChange,
  disabled = false,
}) {
  const handleClick = () => {
    if (disabled) return;
    onChange?.(!checked);
  };

  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${checked ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition
          ${checked ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}
