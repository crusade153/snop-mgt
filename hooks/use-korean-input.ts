import { useState, useRef, useEffect } from 'react';

export function useKoreanInput(externalValue: string, onChange: (v: string) => void) {
  const [localValue, setLocalValue] = useState(externalValue);
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) {
      setLocalValue(externalValue);
    }
  }, [externalValue]);

  return {
    value: localValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
      if (!composing.current) {
        onChange(e.target.value);
      }
    },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
      composing.current = false;
      onChange((e.target as HTMLInputElement).value);
    },
  };
}
