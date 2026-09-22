import fs from "node:fs";
import path from "node:path";

function matchesType(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

function uniqueItems(values) {
  const serialized = values.map((value) => JSON.stringify(value));
  return new Set(serialized).size === serialized.length;
}

function loadReference(reference, schemaPath) {
  if (reference.startsWith("#")) {
    throw new Error(`Local fragment references are not supported by the batch schema validator: ${reference}`);
  }
  const referencePath = path.resolve(path.dirname(schemaPath), reference);
  return {
    schema: JSON.parse(fs.readFileSync(referencePath, "utf8")),
    schemaPath: referencePath,
  };
}

export function validateSchema(value, schema, schemaPath, valuePath = "$") {
  if (schema.$ref) {
    const referenced = loadReference(schema.$ref, schemaPath);
    return validateSchema(value, referenced.schema, referenced.schemaPath, valuePath);
  }

  if (schema.anyOf) {
    const candidates = schema.anyOf.map((candidate) =>
      validateSchema(value, candidate, schemaPath, valuePath));
    return candidates.some((errors) => errors.length === 0)
      ? []
      : [`${valuePath} does not match any allowed schema`];
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) =>
      validateSchema(value, candidate, schemaPath, valuePath).length === 0);
    return matches.length === 1
      ? []
      : [`${valuePath} matches ${matches.length} schemas; expected exactly one`];
  }

  const errors = [];
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${valuePath} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((entry) => entry === value)) {
    errors.push(`${valuePath} is not in the allowed enum`);
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => matchesType(value, expected))) {
      errors.push(`${valuePath} must have type ${expectedTypes.join(" or ")}`);
      return errors;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${valuePath} is shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${valuePath} does not match ${schema.pattern}`);
    }
  }

  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${valuePath} is less than ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${valuePath} has fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems && !uniqueItems(value)) {
      errors.push(`${valuePath} contains duplicate items`);
    }
    if (schema.items) {
      value.forEach((entry, index) => {
        errors.push(...validateSchema(entry, schema.items, schemaPath, `${valuePath}[${index}]`));
      });
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(`${valuePath}.${required} is required`);
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        errors.push(...validateSchema(entry, schema.properties[key], schemaPath, `${valuePath}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${valuePath}.${key} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateSchema(entry, schema.additionalProperties, schemaPath, `${valuePath}.${key}`));
      }
    }
  }

  return errors;
}