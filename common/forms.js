/**
 * common/forms.js - page capability registry for NatsrUnified.
 *
 * NatsrUnified (natsrunified.losscontrol360.com) is the same LossControl360 v2
 * platform as BoostUSA: ASP.NET MVC with the client-side DynForms engine. So
 * this registry follows the NSR-Boost model, not the old NSR one:
 *
 *   - `inspectionFormID` in the URL is per-inspection, not per-form-definition,
 *     so a form is identified by its title plus a signature of its main
 *     section headings, never by a hard-coded GUID.
 *   - the survey type is read off the engine
 *     (formInfo.inspectionInfo.inspectionType), or from the "Survey Type" row
 *     on General Information, which has no engine.
 *
 * Entries use the NSR field name `caseTypes` (not NSR-Boost's `surveyTypes`)
 * because the side panel came from NSR and groups its supported-forms list by
 * `caseTypes`. Everything here reads the same key, so there is only one.
 *
 * Loaded in the content script (window.NSR_FORMS), the service worker
 * (self.NSR_FORMS) and the side panel.
 */

(function () {
  'use strict';

  // Exact strings the platform reports. Verified live on 2026-11-09:
  //   survey 2741 - "Exterior Homeowner New Business"
  //   survey 2721 - "Renewal Request"
  // Both belong to the Orarius Underwriting division and both carry the same
  // single form, "Orarius Underwriting Exterior".
  const CASE_TYPES = {
    EXTERIOR_HOMEOWNER_NEW_BUSINESS: 'Exterior Homeowner New Business',
    RENEWAL_REQUEST: 'Renewal Request',
  };

  const ORARIUS_CASE_TYPES = [
    CASE_TYPES.EXTERIOR_HOMEOWNER_NEW_BUSINESS,
    CASE_TYPES.RENEWAL_REQUEST,
  ];

  // Every supported type, as one readable string for the "not supported" copy.
  const SUPPORTED_SURVEY_LABEL = Object.values(CASE_TYPES).join(' / ');

  /**
   * SUPPORTED_FORMS entry shape (same meaning as NSR's registry):
   *
   *   formId           stable id
   *   name             display name
   *   titleHint        substring matched against the form title
   *   flow             verify | knowledge_base | kb_then_verify
   *   pageType         cover | general, for the knowledge-base call
   *   kind             form | generic_fields
   *   caseTypes        survey types the entry applies to
   *   sectionSignature main-section headings that must all be present
   *   coverFields      (kb_then_verify) cover questions sent to the knowledge
   *                    base. Plain string, or { match, key } when the backend
   *                    key differs from the on-page label. These questions are
   *                    taken OUT of the verify leg - they are the inspector's
   *                    own narrative, not something the AI should answer.
   *   genericFields    (generic_fields) General Information rows to send
   */
  const SUPPORTED_FORMS = [
    {
      // The one form these survey types carry. It holds the cover narrative
      // and the questions on a single page:
      //
      //   Survey comments              Inspection comments / Special
      //                                instructions comments (textarea),
      //                                Opinion of Risk (radio)
      //   Dwelling Information         construction, roof, finish, garages...
      //   Overall Premise Observations access, housekeeping, nuisances,
      //                                animals, protection, water, perils
      //
      // So it runs the chained flow NSR uses for the Condos Dual form: the
      // inspection comments are saved to the knowledge base as the cover, then
      // the remaining questions go to /verify-direct. One button does both.
      formId: 'orarius-underwriting-exterior',
      name: 'Orarius Underwriting Exterior',
      shortName: 'Orarius Exterior',
      titleHint: 'Orarius Underwriting Exterior',
      flow: 'kb_then_verify',
      pageType: 'cover',
      kind: 'form',
      caseTypes: ORARIUS_CASE_TYPES,
      sectionSignature: [
        'Survey comments',
        'Dwelling Information',
        'Overall Premise Observations',
      ],
      // On-page label: "Inspection comments / Special instructions comments:".
      // Emitted under "Inspection Comments", the key NSR already sends for the
      // Brownstone cover's inspection comments.
      coverFields: [
        { match: 'Inspection comments', key: 'Inspection Comments' },
      ],
    },

    {
      // Not a DynForms page - a plain server-rendered detail view, read by
      // content/generalinfo.js. Its "Extra Info" panel is empty for this
      // division, so the knowledge-base payload is the address only (the same
      // address-only shape NSR sends for Brownstone, Condos and Abbreviated).
      // The row is labelled "Address to be Surveyed"; generalinfo.js emits it
      // under the backend key "Address".
      formId: 'orarius-general-information',
      name: 'General Information',
      shortName: 'General Information',
      titleHint: 'General Information',
      flow: 'knowledge_base',
      pageType: 'general',
      kind: 'generic_fields',
      isGeneralInfo: true,
      caseTypes: ORARIUS_CASE_TYPES,
      genericFields: ['Address to be Surveyed'],
    },
  ];

  // ── Autopilot ──────────────────────────────────────────────────────
  //
  // Survey types listed here run without a click: the first time the side
  // panel sees any page of such a survey it works through these steps, each in
  // a background tab beside the survey tab. See sidepanel.js section 6b.
  //
  //   nav   exact text of the survey's left-hand link to open for the step
  //   step  'photos' (describe the photos) or 'sync' (SCRAPE_AND_VERIFY)
  //
  // Order Photos is not a page on this platform - it is the Order/Edit Photos
  // dialog, which exists on every page of the survey. The photos step opens
  // General Information (the lightest page, no form engine), opens that dialog
  // there, reads it, and closes the tab without saving anything.
  //
  // Order follows NSR: photos, general, then the form, so the photo pass and
  // the knowledge-base saves are on the backend before questions are answered.
  // The form step is the chained flow, so it saves the inspection comments and
  // then fetches the AI answers in one go.
  const ORARIUS_AUTOPILOT = {
    steps: [
      { id: 'photos', label: 'Order Photos', nav: 'General Information', step: 'photos' },
      { id: 'general', label: 'General Information', nav: 'General Information', step: 'sync' },
      { id: 'verify', label: 'Inspection comments + Answers', nav: 'Orarius Underwriting Exterior', step: 'sync' },
    ],
  };

  const AUTOPILOT = {
    [CASE_TYPES.EXTERIOR_HOMEOWNER_NEW_BUSINESS]: ORARIUS_AUTOPILOT,
    [CASE_TYPES.RENEWAL_REQUEST]: ORARIUS_AUTOPILOT,
  };

  // ── Helpers ────────────────────────────────────────────────────────

  function normalize(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function autopilotFor(caseTypeName) {
    return AUTOPILOT[normalize(caseTypeName)] || null;
  }

  const NATSR_HOST = 'natsrunified.losscontrol360.com';

  /** Could this hostname host a NatsrUnified inspection page at all? */
  function isNatsrHost(hostname) {
    return hostname === NATSR_HOST;
  }

  /**
   * Is this survey type one the extension supports? A blank type means the
   * page did not report one (engine not loaded yet, or a page with neither an
   * engine nor a GI grid). That is unknown, not a pass.
   */
  function isSupportedSurveyType(surveyType) {
    const type = normalize(surveyType).toLowerCase();
    if (!type) return false;
    return Object.values(CASE_TYPES).some((x) => normalize(x).toLowerCase() === type);
  }

  function appliesToCaseType(form, surveyType) {
    if (!Array.isArray(form.caseTypes) || !form.caseTypes.length) return true;
    const type = normalize(surveyType).toLowerCase();
    return form.caseTypes.some((x) => normalize(x).toLowerCase() === type);
  }

  /**
   * Match a DynForms form against the registry. Three gates, in order:
   * survey type, then title, then section signature.
   *
   * Returns null when no entry's title matches, else
   * { form, matched, reason?, surveyTypeRejected? }.
   */
  function matchForm(title, mainSections, surveyType) {
    const t = normalize(title).toLowerCase();
    if (!t) return null;

    const sections = (mainSections || []).map((s) => normalize(s).toLowerCase());
    const type = normalize(surveyType);

    if (!isSupportedSurveyType(type)) {
      return {
        form: null,
        matched: false,
        reason: type
          ? `Survey type "${type}" is not supported. This build handles ${SUPPORTED_SURVEY_LABEL} only.`
          : 'Survey type could not be determined for this page.',
        surveyTypeRejected: true,
      };
    }

    for (const form of SUPPORTED_FORMS) {
      if (form.isGeneralInfo) continue; // GI has no engine; content.js handles it
      const hint = normalize(form.titleHint).toLowerCase();
      if (!hint || !t.includes(hint)) continue;

      if (!appliesToCaseType(form, type)) {
        return {
          form,
          matched: false,
          reason: `"${form.name}" is not available for survey type "${type}".`,
          surveyTypeRejected: true,
        };
      }

      const sig = form.sectionSignature || [];
      const missing = sig.filter((want) => !sections.some((s) => s.includes(want.toLowerCase())));
      if (missing.length) {
        return { form, matched: false, reason: `Section signature mismatch: missing ${missing.join(', ')}` };
      }

      return { form, matched: true };
    }
    return null;
  }

  /** The General Information entry for a survey type, or null. */
  function generalInfoFor(surveyType) {
    return SUPPORTED_FORMS.find((f) => f.isGeneralInfo && appliesToCaseType(f, surveyType)) || null;
  }

  /**
   * Host-level capability check for the service worker. URL only - no DOM,
   * since this also runs in the worker. Form, General Information and the
   * Order/Edit Photos dialog all live under /Inspection/.
   */
  function capabilitiesForUrl(url) {
    let hostname = '';
    let pathname = '';
    try {
      const u = new URL(url);
      hostname = u.hostname;
      pathname = u.pathname;
    } catch (_) {
      return { hostname: '', form: false, images: false };
    }

    const onInspection = isNatsrHost(hostname) && /^\/Inspection(\/|$)/i.test(pathname);
    return { hostname, form: onInspection, images: onInspection };
  }

  /**
   * Stable identity for a page, for "is this still the page the operation
   * started on?" checks.
   *
   * A raw URL string will not do: `contextID` changes between visits to the
   * same form and query parameters do not come back in a stable order. What
   * identifies a page is the origin, the path (which carries the inspection
   * GUID) and `inspectionFormID` (the form open in it). GUIDs are lower-cased
   * because the platform's own links mix their casing.
   */
  function pageKeyOf(url) {
    try {
      const u = new URL(String(url));
      let formId = '';
      for (const [k, v] of u.searchParams) {
        if (k.toLowerCase() === 'inspectionformid') { formId = v.toLowerCase(); break; }
      }
      return `${u.origin}${u.pathname.replace(/\/+$/, '').toLowerCase()}${formId ? `#${formId}` : ''}`;
    } catch (_) {
      return String(url == null ? '' : url).trim();
    }
  }

  /** Do two URLs point at the same page? Empty input never matches. */
  function samePage(a, b) {
    if (!a || !b) return false;
    return pageKeyOf(a) === pageKeyOf(b);
  }

  /**
   * The inspection GUID out of a NatsrUnified URL. It sits in the path, not a
   * query parameter:
   *   /Inspection/<guid>                         General Information
   *   /Inspection/Form/<guid>?inspectionFormID=  a form
   *   /Inspection/AttachFiles/<guid>             Attach Files
   */
  function inspectionIdOf(url) {
    const m = String(url || '').match(
      /\/Inspection\/(?:[A-Za-z]+\/)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
    );
    return m ? m[1].toLowerCase() : '';
  }

  const api = {
    CASE_TYPES,
    SUPPORTED_SURVEY_LABEL,
    SUPPORTED_FORMS,
    AUTOPILOT,
    autopilotFor,
    isNatsrHost,
    isSupportedSurveyType,
    appliesToCaseType,
    matchForm,
    generalInfoFor,
    normalize,
    capabilitiesForUrl,
    pageKeyOf,
    samePage,
    inspectionIdOf,
  };

  if (typeof window !== 'undefined') window.NSR_FORMS = api;
  else if (typeof self !== 'undefined') self.NSR_FORMS = api;
})();
