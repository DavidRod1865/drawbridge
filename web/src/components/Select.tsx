import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered as a non-selectable heading above the option. */
  group?: string;
}

interface Props {
  options: readonly SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Appended below the options and styled as an action, e.g. '+ New Drawing Area…'. */
  actionLabel?: string;
  onAction?: () => void;
  ariaLabel?: string;
  /** Merged onto the trigger button — layout/width control from the caller. */
  className?: string;
  /**
   * Let the filter box commit a value that isn't in `options` (Enter or the
   * "Use …" row). Used where Procore accepts free-form names.
   */
  allowCustom?: boolean;
}

/** Above this many options the panel gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * Filterable dropdown built on Radix Popover + cmdk Command.
 *
 * Replaces the old bespoke dropdown: a native <select> is used nowhere because macOS
 * renders its popup itself, ignoring every CSS property. cmdk renders the list in the
 * DOM so it matches the rest of the interface and brings filtering, grouping, and
 * keyboard navigation for free. The public API (options/value/onChange/action) is
 * unchanged so every existing caller keeps working.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  actionLabel,
  onAction,
  ariaLabel,
  className,
  allowCustom = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const showFilter = allowCustom || options.length > FILTER_THRESHOLD;
  const selected = options.find((option) => option.value === value) ?? null;
  // Custom values aren't in `options` — still show them on the trigger.
  const displayLabel = selected?.label ?? (allowCustom && value ? value : null);

  const trimmedSearch = search.trim();
  const canCreate =
    allowCustom &&
    trimmedSearch.length > 0 &&
    !options.some(
      (option) =>
        option.value.toLowerCase() === trimmedSearch.toLowerCase() ||
        option.label.toLowerCase() === trimmedSearch.toLowerCase(),
    );

  // Preserve source order while collecting each option under its (optional) group
  // heading, so grouped and ungrouped options render the way callers pass them.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SelectOption[]>();
    for (const option of options) {
      const key = option.group ?? '';
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(option);
      else byGroup.set(key, [option]);
    }
    return [...byGroup.entries()];
  }, [options]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setSearch('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          className={cn(
            'h-[34px] w-full justify-between px-2.5 font-normal',
            !displayLabel && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{displayLabel ?? placeholder}</span>
          <ChevronDown className="text-muted-foreground opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[max(var(--radix-popover-trigger-width),200px)] p-0"
      >
        <Command>
          {showFilter && (
            <CommandInput
              placeholder={allowCustom ? 'Filter or type custom…' : 'Filter…'}
              value={search}
              onValueChange={setSearch}
            />
          )}
          <CommandList>
            <CommandEmpty>{allowCustom ? 'Type a custom name' : 'No matches'}</CommandEmpty>
            {groups.map(([heading, groupOptions]) => (
              <CommandGroup key={heading || '_'} {...(heading ? { heading } : {})}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={choose}
                  >
                    <Check
                      className={cn(
                        'text-primary',
                        option.value === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {canCreate && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    // Prefix keeps cmdk from filtering this row away while searching.
                    value={`use-custom-${trimmedSearch}`}
                    className="text-primary data-[selected=true]:text-primary"
                    onSelect={() => choose(trimmedSearch)}
                  >
                    Use “{trimmedSearch}”
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
          {/* The create action is pinned below the list, not a CommandItem: as a plain
              button it is exempt from cmdk's filtering, so "+ New …" stays visible even
              when the search matches nothing (exactly when the user wants to create it),
              and never scrolls out of view in a long list. */}
          {actionLabel && onAction && (
            <>
              <div className="-mx-1 my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  onAction();
                }}
              >
                {actionLabel}
              </button>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
