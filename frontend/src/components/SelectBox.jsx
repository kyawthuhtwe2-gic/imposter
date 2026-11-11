"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState } from "react";

export default function SelectBox({
  children,
  disabled = false,
  id,
  onValueChange,
  required = false,
  value,
}) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-options`;
  const rootRef = useRef(null);
  const optionRefs = useRef([]);
  const typeaheadRef = useRef("");
  const typeaheadTimeoutRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((option) => ({
      value: String(option.props.value ?? option.key),
      label: option.props.children,
      disabled: option.props.disabled,
    }));
  const selectedIndex = options.findIndex((option) => option.value === String(value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => () => window.clearTimeout(typeaheadTimeoutRef.current), []);

  function findEnabledIndex(startIndex, direction) {
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (startIndex + offset * direction + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return -1;
  }

  function showOptions(index = selectedIndex) {
    const nextIndex = index >= 0 && !options[index]?.disabled
      ? index
      : findEnabledIndex(0, 1);
    setActiveIndex(Math.max(0, nextIndex));
    setOpen(true);
  }

  function selectOption(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        showOptions(selectedIndex >= 0 ? selectedIndex : findEnabledIndex(0, 1));
      } else {
        setActiveIndex((currentIndex) =>
          findEnabledIndex((currentIndex + direction + options.length) % options.length, direction),
        );
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      const startIndex = event.key === "Home" ? 0 : options.length - 1;
      setActiveIndex(findEnabledIndex(startIndex, event.key === "Home" ? 1 : -1));
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) selectOption(activeIndex);
      else showOptions();
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      window.clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = window.setTimeout(() => {
        typeaheadRef.current = "";
      }, 500);

      const startIndex = open ? activeIndex + 1 : selectedIndex + 1;
      for (let offset = 0; offset < options.length; offset += 1) {
        const index = (startIndex + offset + options.length) % options.length;
        const label = String(options[index].label).toLocaleLowerCase();
        if (!options[index].disabled && label.startsWith(typeaheadRef.current)) {
          setActiveIndex(index);
          setOpen(true);
          break;
        }
      }
    }
  }

  return (
    <div className="select-box" ref={rootRef}>
      <button
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={id}
        aria-required={required || undefined}
        className="select-trigger"
        disabled={disabled}
        id={id}
        onClick={() => (open ? setOpen(false) : showOptions())}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span>{selectedOption?.label}</span>
        <svg aria-hidden="true" className="select-chevron" viewBox="0 0 20 20">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="select-menu" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <div
              aria-disabled={option.disabled || undefined}
              aria-selected={index === selectedIndex}
              className={`select-option${index === activeIndex ? " active" : ""}${index === selectedIndex ? " selected" : ""}`}
              id={`${listboxId}-${index}`}
              key={option.value}
              onClick={() => selectOption(index)}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="option"
            >
              <span>{option.label}</span>
              {index === selectedIndex && <span aria-hidden="true" className="select-option-check">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}