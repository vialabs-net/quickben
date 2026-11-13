"use client";

import { Button, Input, Label, Select, Toast } from "@quickben/admin/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { TestView } from "./state";

type Notice = { key: number; message: string; tone: "success" | "error" };

function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = (view: TestView) => {
    const key = (notice?.key ?? 0) + 1;
    if (view.status === "done") {
      setNotice({
        key,
        message: `${view.title}. ${view.message}`,
        tone: view.ok ? "success" : "error",
      });
    } else {
      setNotice({ key, message: view.message, tone: "error" });
    }
  };
  const element = notice ? (
    <Toast
      key={notice.key}
      message={notice.message}
      tone={notice.tone}
      duration={notice.tone === "error" ? 8000 : 4000}
    />
  ) : null;
  return { show, element };
}

/** "Test" on a connection: runs the provider test, shows the result as a toast. */
export function TestConnectionButton({
  action,
  size = "md",
}: Readonly<{ action: () => Promise<TestView>; size?: "sm" | "md" }>) {
  const router = useRouter();
  const [pending, startTest] = useTransition();
  const { show, element } = useNotice();
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        disabled={pending}
        onClick={() => {
          startTest(async () => {
            show(await action());
            router.refresh();
          });
        }}
      >
        {pending ? "Testing…" : "Test"}
      </Button>
      {element}
    </>
  );
}

/** Props of {@link TestCredentialButton}. */
export interface TestCredentialButtonProps {
  action: (input: { providerType?: string; baseUrl?: string }) => Promise<TestView>;
  /** Providers that take the credential's kind. */
  providers: readonly { type: string; label: string }[];
  /** `false`: no connection uses it, so ask for a provider first. */
  used: boolean;
}

/**
 * "Test" on a credential. A credential in use is tried with the provider of its first
 * connection; an unused one opens a dialog that asks for the provider and an optional URL.
 */
export function TestCredentialButton({
  action,
  providers,
  used,
}: Readonly<TestCredentialButtonProps>) {
  const router = useRouter();
  const [pending, startTest] = useTransition();
  const [asking, setAsking] = useState(false);
  const { show, element } = useNotice();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (asking && !node.open) node.showModal();
    if (!asking && node.open) node.close();
  }, [asking]);
  const run = (input: { providerType?: string; baseUrl?: string }) => {
    startTest(async () => {
      const view = await action(input);
      if (view.status === "pick-provider") {
        setAsking(true);
        return;
      }
      setAsking(false);
      show(view);
      router.refresh();
    });
  };
  return (
    <>
      <Button
        variant="secondary"
        disabled={pending && !asking}
        onClick={() => {
          if (used) run({});
          else setAsking(true);
        }}
      >
        {pending && !asking ? "Testing…" : "Test"}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="qb-test-credential-title"
        onClose={() => {
          setAsking(false);
        }}
        className="qb:w-full qb:max-w-sm qb:rounded-lg qb:border qb:border-zinc-200 qb:bg-white qb:p-5 qb:shadow-lg"
        style={{ margin: "auto" }}
      >
        <form
          method="dialog"
          className="qb:space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const providerType = data.get("providerType");
            const baseUrl = data.get("baseUrl");
            run({
              ...(typeof providerType === "string" ? { providerType } : {}),
              ...(typeof baseUrl === "string" && baseUrl.trim() !== "" ? { baseUrl } : {}),
            });
          }}
        >
          <div>
            <h2
              id="qb-test-credential-title"
              className="qb:text-sm qb:font-semibold qb:text-zinc-900"
            >
              Test the credential
            </h2>
            <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">
              No connection uses it yet. Choose a provider to try it with.
            </p>
          </div>
          <div className="qb:space-y-1.5">
            <Label htmlFor="qb-test-provider">Provider</Label>
            <Select id="qb-test-provider" name="providerType" required>
              {providers.map((provider) => (
                <option key={provider.type} value={provider.type}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="qb:space-y-1.5">
            <Label htmlFor="qb-test-url">Base URL</Label>
            <Input
              id="qb-test-url"
              name="baseUrl"
              type="url"
              placeholder="The provider's default"
            />
          </div>
          <div className="qb:flex qb:gap-2">
            <Button type="submit" disabled={pending || providers.length === 0}>
              {pending ? "Testing…" : "Test"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
      {element}
    </>
  );
}
