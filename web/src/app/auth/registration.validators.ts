import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function unicodeLength(min: number, max: number, trim = false): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (typeof value !== 'string') return { text: true };
    const text = trim ? value.trim() : value;
    const length = Array.from(text).length;
    return length >= min && length <= max && /\S/u.test(text) ? null : { length: true };
  };
}
export const passwordsMatch: ValidatorFn = (form) =>
  form.get('password')?.value === form.get('confirmation')?.value ? null : { mismatch: true };
