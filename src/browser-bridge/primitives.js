export const BRIDGE_PRIMITIVE_CLASS = Object.freeze({
  READ: "read",
  WRITE: "write"
});

export const BRIDGE_PRIMITIVE_ID = Object.freeze({
  HEALTH_CHECK: "bridge.health_check",
  CAPTURE_SOURCE: "capture.source",
  CAPTURE_LINKEDIN_SOURCE: "capture.linkedin_source",
  FORM_EXTRACT_SCHEMA: "forms.extract_schema",
  APPLY_CLICK: "jobs.apply_click",
  FORM_TYPE_TEXT: "forms.type_text",
  FORM_UPLOAD_FILE: "forms.upload_file",
  DIALOG_CONFIRM_ACTION: "dialogs.confirm_action"
});

export const BRIDGE_SURFACE = Object.freeze({
  MCP_V1: "mcp_v1",
  APPLY_V1: "apply_v1"
});

// Primitives that may never be exposed on any HTTP surface. Submission must
// always be a human action: the system can draft and fill, but clicking
// apply/submit or confirming side-effect dialogs is structurally impossible,
// not merely policy-forbidden. Approved boundary: docs/roadmap/decision-log.md
// entry 2026-07-10 and docs/plans/2026-07-10-apply-engine-mvp-execplan.md.
const NEVER_EXPOSABLE_PRIMITIVE_IDS = Object.freeze(
  new Set([
    BRIDGE_PRIMITIVE_ID.APPLY_CLICK,
    BRIDGE_PRIMITIVE_ID.DIALOG_CONFIRM_ACTION
  ])
);

// Per-surface write allowlists. Read primitives are allowed on every known
// surface; write primitives are deny-by-default and must be listed here.
const SURFACE_WRITE_ALLOWLIST = Object.freeze({
  [BRIDGE_SURFACE.MCP_V1]: Object.freeze(new Set()),
  [BRIDGE_SURFACE.APPLY_V1]: Object.freeze(
    new Set([
      BRIDGE_PRIMITIVE_ID.FORM_TYPE_TEXT,
      BRIDGE_PRIMITIVE_ID.FORM_UPLOAD_FILE
    ])
  )
});

const BRIDGE_PRIMITIVE_CATALOG = Object.freeze([
  {
    id: BRIDGE_PRIMITIVE_ID.HEALTH_CHECK,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.READ,
    description: "Read bridge availability and provider metadata."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.CAPTURE_SOURCE,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.READ,
    description: "Read-only capture/import operation for configured sources."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.CAPTURE_LINKEDIN_SOURCE,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.READ,
    description: "Read-only compatibility alias for LinkedIn capture."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.FORM_EXTRACT_SCHEMA,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.READ,
    description:
      "Read the field structure (labels, types, required flags, options) of an application form on a bridge-owned tab."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.APPLY_CLICK,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.WRITE,
    description: "Click apply/submit controls in external job pages."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.FORM_TYPE_TEXT,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.WRITE,
    description: "Type into mutable form fields."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.FORM_UPLOAD_FILE,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.WRITE,
    description: "Upload files in external forms."
  },
  {
    id: BRIDGE_PRIMITIVE_ID.DIALOG_CONFIRM_ACTION,
    primitiveClass: BRIDGE_PRIMITIVE_CLASS.WRITE,
    description: "Confirm dialogs that trigger external side effects."
  }
]);

const BRIDGE_PRIMITIVE_BY_ID = new Map(
  BRIDGE_PRIMITIVE_CATALOG.map((primitive) => [primitive.id, primitive])
);

export function listBridgePrimitives() {
  return BRIDGE_PRIMITIVE_CATALOG.map((primitive) => ({ ...primitive }));
}

export function getBridgePrimitiveById(primitiveId) {
  return BRIDGE_PRIMITIVE_BY_ID.get(String(primitiveId || "").trim()) || null;
}

export function ensureBridgePrimitiveCatalogIntegrity() {
  const seen = new Set();

  for (const primitive of BRIDGE_PRIMITIVE_CATALOG) {
    const id = String(primitive.id || "").trim();
    if (!id) {
      throw new Error("Bridge primitive id is required.");
    }

    if (seen.has(id)) {
      throw new Error(`Duplicate bridge primitive id: ${id}`);
    }
    seen.add(id);

    if (
      primitive.primitiveClass !== BRIDGE_PRIMITIVE_CLASS.READ &&
      primitive.primitiveClass !== BRIDGE_PRIMITIVE_CLASS.WRITE
    ) {
      throw new Error(
        `Bridge primitive "${id}" has unsupported class "${primitive.primitiveClass}".`
      );
    }
  }
}

export function validatePrimitiveSurfaceRegistration({
  surface,
  primitiveIds
}) {
  const normalizedSurface = String(surface || "").trim();
  if (!normalizedSurface) {
    throw new Error("Surface is required for primitive registration validation.");
  }

  if (!Array.isArray(primitiveIds) || primitiveIds.length === 0) {
    throw new Error("At least one primitive id is required for registration validation.");
  }

  const writeAllowlist = SURFACE_WRITE_ALLOWLIST[normalizedSurface];
  if (!writeAllowlist) {
    throw new Error(
      `Unknown bridge surface "${normalizedSurface}". Known surfaces: ${Object.keys(
        SURFACE_WRITE_ALLOWLIST
      ).join(", ")}.`
    );
  }

  const invalidIds = [];
  const neverExposableIds = [];
  const disallowedWriteIds = [];

  for (const primitiveId of primitiveIds) {
    const primitive = getBridgePrimitiveById(primitiveId);
    if (!primitive) {
      invalidIds.push(String(primitiveId));
      continue;
    }

    if (NEVER_EXPOSABLE_PRIMITIVE_IDS.has(primitive.id)) {
      neverExposableIds.push(primitive.id);
      continue;
    }

    if (
      primitive.primitiveClass === BRIDGE_PRIMITIVE_CLASS.WRITE &&
      !writeAllowlist.has(primitive.id)
    ) {
      disallowedWriteIds.push(primitive.id);
    }
  }

  if (invalidIds.length > 0) {
    throw new Error(
      `Unknown bridge primitive id(s): ${invalidIds.join(", ")}.`
    );
  }

  if (neverExposableIds.length > 0) {
    throw new Error(
      `Primitive(s) ${neverExposableIds.join(", ")} may never be exposed on any surface: submission is always a human action.`
    );
  }

  if (disallowedWriteIds.length > 0) {
    if (normalizedSurface === BRIDGE_SURFACE.MCP_V1) {
      throw new Error(
        `MCP v1 cannot expose write primitives: ${disallowedWriteIds.join(", ")}.`
      );
    }

    throw new Error(
      `Surface "${normalizedSurface}" cannot expose write primitives: ${disallowedWriteIds.join(", ")}.`
    );
  }
}
