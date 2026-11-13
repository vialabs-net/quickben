"use client";

import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/input";

import type { ChangeEvent } from "react";

/** Props of {@link JsonEditor}. */
export interface JsonEditorProps {
  id: string;
  name: string;
  defaultValue: string;
  required: boolean;
  disabled: boolean;
  describedBy: string;
}

function jsonError(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
}

/** Textarea for JSON values. Checks the syntax while typing and blocks submit when invalid. */
export function JsonEditor({
  id,
  name,
  defaultValue,
  required,
  disabled,
  describedBy,
}: Readonly<JsonEditorProps>) {
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const check = (element: HTMLTextAreaElement) => {
    const problem = jsonError(element.value);
    element.setCustomValidity(problem ? "Enter valid JSON" : "");
    setError(problem);
  };

  const format = () => {
    const element = ref.current;
    if (!element || jsonError(element.value) || element.value.trim() === "") return;
    element.value = JSON.stringify(JSON.parse(element.value), null, 2);
    check(element);
  };

  return (
    <div className="qb:space-y-2">
      <Textarea
        ref={ref}
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        disabled={disabled}
        rows={8}
        spellCheck={false}
        aria-describedby={`${describedBy} ${id}-json`}
        className="qb:font-mono qb:text-xs"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          check(event.currentTarget);
        }}
      />
      <div className="qb:flex qb:items-center qb:justify-between qb:gap-3">
        <p
          id={`${id}-json`}
          aria-live="polite"
          className={error ? "qb:text-xs qb:text-red-600" : "qb:text-xs qb:text-zinc-500"}
        >
          {error ? `Invalid JSON: ${error}` : "JSON"}
        </p>
        {disabled ? null : (
          <Button size="sm" variant="ghost" onClick={format} disabled={error !== null}>
            Format
          </Button>
        )}
      </div>
    </div>
  );
}
