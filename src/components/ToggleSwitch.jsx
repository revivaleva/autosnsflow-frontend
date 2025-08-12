// src/components/ToggleSwitch.jsx
"use client";
import React from "react";

export function ToggleSwitch({ enabled, checked, onChange, disabled }) {
  const isChecked = checked ?? enabled ?? false;

  const toggle = () => {
    if (!disabled) onChange?.(!isChecked);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange?.(!isChecked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={onKeyDown}
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

export default ToggleSwitch;
