import { useEffect, useMemo, useRef, useState } from 'react';

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
  className?: string;
}

/** Above this many options the panel gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * Custom dropdown.
 *
 * A native <select> is used nowhere in the app because macOS renders its popup
 * itself — the open menu ignores every CSS property, coming out ~1.4x the page font
 * with its own row heights and colours. Rendering the list in the DOM is the only way
 * to make dropdowns match the rest of the interface, and it also buys filtering and
 * grouping that native menus cannot express.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  actionLabel,
  onAction,
  ariaLabel,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const showFilter = options.length > FILTER_THRESHOLD;

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, filter]);

  const selected = options.find((option) => option.value === value) ?? null;

  // Close on outside click or Escape. Without this the panel survives clicks
  // elsewhere on the page, which native selects handle for free.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && showFilter) filterRef.current?.focus();
  }, [open, showFilter]);

  function choose(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
    setFilter('');
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setOpen(true);
      setActive(0);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[active];
      if (option) choose(option.value);
    }
  }

  let lastGroup: string | undefined;

  return (
    <div ref={rootRef} className={`select ${className}`}>
      <button
        type="button"
        className={`select-trigger${selected ? '' : ' placeholder'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="select-value">{selected?.label ?? placeholder}</span>
        <svg className="select-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="select-panel" role="listbox">
          {showFilter && (
            <input
              ref={filterRef}
              className="select-filter"
              value={filter}
              placeholder="Filter…"
              aria-label="Filter options"
              onChange={(event) => {
                setFilter(event.target.value);
                setActive(0);
              }}
              onKeyDown={onTriggerKeyDown}
            />
          )}

          <div className="select-options">
            {visible.length === 0 && <div className="select-empty">No matches</div>}

            {visible.map((option, index) => {
              const heading = option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;

              return (
                <div key={option.value}>
                  {heading && <div className="select-group">{heading}</div>}
                  <div
                    role="option"
                    aria-selected={option.value === value}
                    className={`select-option${index === active ? ' active' : ''}${
                      option.value === value ? ' selected' : ''
                    }`}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => {
                      // mousedown, not click: the outside-click handler fires first
                      // on mousedown and would close the panel before click lands.
                      event.preventDefault();
                      choose(option.value);
                    }}
                  >
                    {option.label}
                  </div>
                </div>
              );
            })}
          </div>

          {actionLabel && onAction && (
            <button
              type="button"
              className="select-action"
              onMouseDown={(event) => {
                event.preventDefault();
                setOpen(false);
                onAction();
              }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
