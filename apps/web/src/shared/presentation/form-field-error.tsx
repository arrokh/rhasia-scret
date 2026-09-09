type FormFieldErrorProps = {
  id: string;
  errors: unknown[];
};

export function FormFieldError({ id, errors }: FormFieldErrorProps) {
  const message = errors.find((error): error is string => typeof error === "string" && error.length > 0);
  return message ? (
    <p id={id} className="text-sm leading-5 font-medium text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}
