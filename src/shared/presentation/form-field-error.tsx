type FormFieldErrorProps = {
  id: string;
  errors: unknown[];
};

export function FormFieldError({ id, errors }: FormFieldErrorProps) {
  const message = errors.find((error): error is string => typeof error === "string" && error.length > 0);
  return message ? <p id={id} className="form-status" role="alert">{message}</p> : null;
}

export function requiredText(label: string) {
  return ({ value }: { value: string }) => value.trim() ? undefined : `${label} wajib diisi.`;
}
