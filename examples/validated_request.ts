import { Invalid, InvalidMessages, Valid } from "../src/validation.ts";
import { Applicative } from "../src/typeclasses.ts";

export type RegistrationRequest = {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly age: number;
};

type AcceptedRegistration = {
  readonly status: "accepted";
  readonly request: RegistrationRequest;
};

type RejectedRegistration = {
  readonly status: "rejected";
  readonly messages: readonly string[];
};

export type RegistrationDecodeResult =
  | AcceptedRegistration
  | RejectedRegistration;

export function decode_registration_request(
  form: FormData,
): RegistrationDecodeResult {
  const request = Applicative.lift(
    (username, email, password, age): RegistrationRequest => ({
      username,
      email,
      password,
      age,
    }),
    validate_username(form.get("username")),
    validate_email(form.get("email")),
    validate_password(form.get("password")),
    validate_age(form.get("age")),
  );
  const result = request.value();

  if (Invalid.is(result)) {
    return { status: "rejected", messages: result[1] };
  }

  return { status: "accepted", request: result[1] };
}

export function run_validated_request_examples() {
  const accepted_form = new FormData();
  accepted_form.set("username", " ada_lovelace ");
  accepted_form.set("email", " ADA@example.test ");
  accepted_form.set("password", "analytical42");
  accepted_form.set("age", "36");

  const rejected_form = new FormData();
  rejected_form.set("username", "");
  rejected_form.set("email", "ada.example.test");
  rejected_form.set("password", "short");
  rejected_form.set("age", "sixteen");

  const accepted = decode_registration_request(accepted_form);
  const rejected = decode_registration_request(rejected_form);

  if (accepted.status === "accepted") {
    console.log(
      "validated registration accepted",
      Deno.inspect({
        username: accepted.request.username,
        email: accepted.request.email,
        age: accepted.request.age,
      }),
    );
  }

  console.log("validated registration rejected", Deno.inspect(rejected));
}

function validate_username(value: FormDataEntryValue | null) {
  if (value === null) {
    return InvalidMessages<string>("username is required");
  }

  if (typeof value !== "string") {
    return InvalidMessages<string>("username must be a text field");
  }

  const username = value.trim();

  if (username.length === 0) {
    return InvalidMessages<string>("username is required");
  }

  if (username.length < 3) {
    return InvalidMessages<string>(
      "username must be at least 3 characters",
    );
  }

  if (!/^[a-z0-9_]+$/iu.test(username)) {
    return InvalidMessages<string>(
      "username may contain only letters, numbers, and underscores",
    );
  }

  return Valid(username);
}

function validate_email(value: FormDataEntryValue | null) {
  if (value === null) {
    return InvalidMessages<string>("email is required");
  }

  if (typeof value !== "string") {
    return InvalidMessages<string>("email must be a text field");
  }

  const email = value.trim().toLowerCase();

  if (email.length === 0) {
    return InvalidMessages<string>("email is required");
  }

  const separator = email.indexOf("@");

  if (separator <= 0 || separator === email.length - 1) {
    return InvalidMessages<string>("email must contain a local part and host");
  }

  return Valid(email);
}

function validate_password(value: FormDataEntryValue | null) {
  if (value === null) {
    return InvalidMessages<string>("password is required");
  }

  if (typeof value !== "string") {
    return InvalidMessages<string>("password must be a text field");
  }

  if (value.length === 0) {
    return InvalidMessages<string>("password is required");
  }

  const messages: string[] = [];

  if (value.length < 12) {
    messages.push("password must be at least 12 characters");
  }

  if (!/[0-9]/u.test(value)) {
    messages.push("password must contain a number");
  }

  if (messages.length > 0) {
    return InvalidMessages<string>(messages[0], ...messages.slice(1));
  }

  return Valid(value);
}

function validate_age(value: FormDataEntryValue | null) {
  if (value === null) {
    return InvalidMessages<number>("age is required");
  }

  if (typeof value !== "string") {
    return InvalidMessages<number>("age must be a text field");
  }

  const age_text = value.trim();

  if (age_text.length === 0) {
    return InvalidMessages<number>("age is required");
  }

  const age = Number(age_text);

  if (!Number.isInteger(age)) {
    return InvalidMessages<number>("age must be an integer");
  }

  if (age < 18) {
    return InvalidMessages<number>("age must be at least 18");
  }

  return Valid(age);
}
