// /src/components/ToggleSwitch.jsx

import React from "react";

// 既存のnamed exportを踏襲します
export function ToggleSwitch({
  checked,
  onChange,
  disabled = false, // [ADD] 受け取り
}) {
  const handleClick = () => {
    if (disabled) return;       // [ADD] 無効時は無視
    onChange?.(!checked);
  };

  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled}   // [ADD]
      disabled={disabled}        // [ADD]
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}  // [ADD]
        ${checked ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition
          ${checked ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}
