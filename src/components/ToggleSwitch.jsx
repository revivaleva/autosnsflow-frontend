// /src/components/ToggleSwitch.jsx
import React from "react";

export default function ToggleSwitch({ enabled, checked, onChange, disabled }) {
  const isChecked = checked ?? enabled ?? false;

  const handleClick = () => {
    if (disabled) return;
    onChange?.(!isChecked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={handleClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${isChecked ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition
          ${isChecked ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}
