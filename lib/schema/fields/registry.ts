import type { FieldDefinition, FieldTypeDefinition } from "@/lib/schema/fields/types";
import { isRichTextDocument } from "@/lib/content/richText";
import { isExperienceDocument, validateExperienceDocument } from "@/lib/experience/blockRegistry";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(?:https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/;

function requiredCheck(value: unknown, field: FieldDefinition): string[] {
  if (field.required && (value === undefined || value === null || value === "")) {
    return [`"${field.key}" is required`];
  }
  return [];
}

function textLike(label: string) {
  return (value: unknown, field: FieldDefinition): string[] => {
    const errors = requiredCheck(value, field);
    if (value === undefined || value === null || value === "") return errors;
    if (typeof value !== "string") {
      return [...errors, `"${field.key}" must be a string`];
    }
    const v = field.validation;
    if (v?.minLength !== undefined && value.length < v.minLength) {
      errors.push(`"${field.key}" must be at least ${v.minLength} characters`);
    }
    if (v?.maxLength !== undefined && value.length > v.maxLength) {
      errors.push(`"${field.key}" must be at most ${v.maxLength} characters`);
    }
    if (v?.pattern && !new RegExp(v.pattern).test(value)) {
      errors.push(`"${field.key}" does not match the required pattern`);
    }
    return errors;
  };
}

function numberLike(integerOnly: boolean) {
  return (value: unknown, field: FieldDefinition): string[] => {
    const errors = requiredCheck(value, field);
    if (value === undefined || value === null || value === "") return errors;
    if (typeof value !== "number" || Number.isNaN(value)) {
      return [...errors, `"${field.key}" must be a number`];
    }
    if (integerOnly && !Number.isInteger(value)) {
      errors.push(`"${field.key}" must be an integer`);
    }
    const v = field.validation;
    if (v?.min !== undefined && value < v.min) errors.push(`"${field.key}" must be >= ${v.min}`);
    if (v?.max !== undefined && value > v.max) errors.push(`"${field.key}" must be <= ${v.max}`);
    return errors;
  };
}

export const FIELD_TYPE_REGISTRY: Record<string, FieldTypeDefinition> = {
  text: {
    type: "text",
    label: "Text",
    postgresType: "text",
    supportedValidation: ["required", "unique", "minLength", "maxLength", "pattern"],
    validateValue: textLike("Text"),
  },
  long_text: {
    type: "long_text",
    label: "Long Text",
    postgresType: "text",
    supportedValidation: ["required", "minLength", "maxLength"],
    validateValue: textLike("Long Text"),
  },
  rich_text: {
    type: "rich_text",
    label: "Rich Text",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (value === undefined || value === null || value === "") return errors;
      return isRichTextDocument(value) ? errors : [...errors, `"${field.key}" must be a portable rich-text document`];
    },
  },
  markdown: {
    type: "markdown",
    label: "Markdown",
    postgresType: "text",
    supportedValidation: ["required", "minLength", "maxLength"],
    validateValue: textLike("Markdown"),
  },
  number: {
    type: "number",
    label: "Number",
    postgresType: "numeric",
    supportedValidation: ["required", "min", "max"],
    validateValue: numberLike(false),
  },
  integer: {
    type: "integer",
    label: "Integer",
    postgresType: "bigint",
    supportedValidation: ["required", "min", "max"],
    validateValue: numberLike(true),
  },
  boolean: {
    type: "boolean",
    label: "Boolean",
    postgresType: "boolean",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      if (value === undefined || value === null) return requiredCheck(value, field);
      return typeof value === "boolean" ? [] : [`"${field.key}" must be true or false`];
    },
  },
  date: {
    type: "date",
    label: "Date",
    postgresType: "date",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (!value) return errors;
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? errors : [...errors, `"${field.key}" must be a valid date`];
    },
  },
  datetime: {
    type: "datetime",
    label: "Date/Time",
    postgresType: "timestamptz",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (!value) return errors;
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? errors : [...errors, `"${field.key}" must be a valid date/time`];
    },
  },
  slug: {
    type: "slug",
    label: "Slug",
    postgresType: "text",
    supportedValidation: ["required", "unique"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (!value) return errors;
      if (typeof value !== "string" || !SLUG_RE.test(value)) {
        errors.push(`"${field.key}" must be a lowercase, hyphen-separated slug`);
      }
      return errors;
    },
  },
  email: {
    type: "email",
    label: "Email",
    postgresType: "text",
    supportedValidation: ["required", "unique"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (!value) return errors;
      return typeof value === "string" && EMAIL_RE.test(value) ? errors : [...errors, `"${field.key}" must be a valid email address`];
    },
  },
  url: {
    type: "url",
    label: "URL",
    postgresType: "text",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (!value) return errors;
      return typeof value === "string" && URL_RE.test(value) ? errors : [...errors, `"${field.key}" must be a valid http(s) URL or internal /path`];
    },
  },
  select: {
    type: "select",
    label: "Select",
    postgresType: "text",
    supportedValidation: ["required", "options"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (value === undefined || value === null || value === "") return errors;
      const options = field.validation?.options ?? [];
      if (options.length > 0 && !options.includes(String(value))) {
        errors.push(`"${field.key}" must be one of: ${options.join(", ")}`);
      }
      return errors;
    },
  },
  multi_select: {
    type: "multi_select",
    label: "Multi-select",
    postgresType: "jsonb",
    supportedValidation: ["required", "options"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (value === undefined || value === null) return errors;
      if (!Array.isArray(value)) return [...errors, `"${field.key}" must be an array`];
      const options = field.validation?.options ?? [];
      const invalid = value.filter((v) => options.length > 0 && !options.includes(String(v)));
      if (invalid.length > 0) errors.push(`"${field.key}" contains values outside the allowed options`);
      return errors;
    },
  },
  json: {
    type: "json",
    label: "JSON",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => requiredCheck(value, field),
  },
  media: {
    type: "media",
    label: "Media",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => requiredCheck(value, field),
  },
  file: {
    type: "file",
    label: "File",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => requiredCheck(value, field),
  },
  relation: {
    type: "relation",
    label: "Relation",
    postgresType: "uuid",
    supportedValidation: ["required"],
    validateValue: (value, field) => requiredCheck(value, field),
  },
  component: {
    type: "component",
    label: "Component",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (value === undefined || value === null || value === "") return errors;
      if (typeof value !== "object" || Array.isArray(value)) {
        return [...errors, `"${field.key}" must be a valid Experience document object`];
      }
      const check = validateExperienceDocument(value);
      if (!check.valid) {
        return [...errors, ...check.errors];
      }
      return errors;
    },
  },
  repeater: {
    type: "repeater",
    label: "Repeater",
    postgresType: "jsonb",
    supportedValidation: ["required"],
    validateValue: (value, field) => {
      const errors = requiredCheck(value, field);
      if (value === undefined || value === null) return errors;
      return Array.isArray(value) ? errors : [...errors, `"${field.key}" must be an array`];
    },
  },
};
