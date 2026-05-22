import { promptMultipleSelect } from "@std/cli/unstable-prompt-multiple-select";
import { promptSelect } from "@std/cli/unstable-prompt-select";
import { CHANGE_TYPES, type ChangeType } from "../domain/change-type.ts";
import { DvError } from "../domain/errors.ts";

// Interactive prompts for `dv add` (specs/cli.md § dv add interactive flow).
// `promptSelect` / `promptMultipleSelect` are @std/cli's TTY-aware
// helpers; they read from stdin in raw mode and handle arrow keys
// + spacebar selection. Callers should only reach here in a TTY context.
//
// The Bump preview the spec mentions is intentionally not here yet — it
// needs `read-version` and the bump algebra (`classify` / `apply`),
// which land in milestone 3. Adding it then is a localized change to
// this module.

export interface InteractiveRecordInputs {
  changeType: ChangeType;
  packageNames: string[];
}

export interface PromptForRecordInputsArgs {
  discoveredPackages: string[];
  presetChangeType?: ChangeType;
  presetPackageNames?: string[];
}

export function promptForRecordInputs(
  args: PromptForRecordInputsArgs,
): InteractiveRecordInputs {
  const changeType = args.presetChangeType ?? promptForChangeType();
  const packageNames =
    args.presetPackageNames ??
    promptForPackages({
      discoveredPackages: args.discoveredPackages,
    });
  if (packageNames.length === 0) {
    throw new DvError({
      code: "add-no-packages-selected",
      message: "no packages selected — aborting",
    });
  }
  return { changeType, packageNames };
}

function promptForChangeType(): ChangeType {
  const selectedLabel = promptSelect(
    "What kind of change?",
    CHANGE_TYPES as readonly string[] as string[],
    { clear: true },
  );
  if (selectedLabel === null) {
    throw new DvError({
      code: "add-aborted",
      message: "no change type chosen — aborting",
    });
  }
  return selectedLabel as ChangeType;
}

interface PromptForPackagesArgs {
  discoveredPackages: string[];
}

function promptForPackages(args: PromptForPackagesArgs): string[] {
  const selectedNames = promptMultipleSelect(
    "Which packages does this affect?",
    args.discoveredPackages,
    { clear: true },
  );
  if (selectedNames === null) {
    throw new DvError({
      code: "add-aborted",
      message: "no packages chosen — aborting",
    });
  }
  return selectedNames;
}
