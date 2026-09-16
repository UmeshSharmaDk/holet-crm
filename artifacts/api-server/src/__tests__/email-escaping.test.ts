import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBookingUpdateEmail, escapeHtml } from "../lib/email.js";

/**
 * Guest names and field values are free text from anyone who can create or
 * edit a booking, and the resulting message goes to hotel owners from the
 * CRM's own address. Raw interpolation made that a delivery channel for
 * attacker-authored markup.
 *
 * Pure template assertions — no SMTP and no database involved.
 */
describe("booking update email", () => {
  describe("escapeHtml", () => {
    it("neutralises every character significant in HTML", () => {
      assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
    });

    it("escapes the ampersand first so entities are not double-formed", () => {
      assert.equal(escapeHtml("&lt;"), "&amp;lt;");
    });

    it("handles null and undefined without throwing", () => {
      assert.equal(escapeHtml(null), "");
      assert.equal(escapeHtml(undefined), "");
    });
  });

  const injection = `Rahul<a href="https://attacker.example/login">Re-authenticate</a>`;

  it("does not emit markup from a guest name", () => {
    const { html } = buildBookingUpdateEmail(42, injection, []);
    assert.ok(!html.includes("<a href"), "an anchor tag reached the message body");
    assert.ok(!html.includes("attacker.example/login\">"), "the payload survived intact");
    assert.ok(html.includes("&lt;a href="), "the name should appear escaped, not dropped");
  });

  it("does not emit markup from a changed field value", () => {
    const { html } = buildBookingUpdateEmail(42, "Safe Name", [
      { field: "Status", oldValue: "confirmed", newValue: `<script>alert(1)</script>` },
    ]);
    assert.ok(!html.includes("<script>"), "a script tag reached the message body");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("does not emit markup from a field label", () => {
    const { html } = buildBookingUpdateEmail(42, "Safe Name", [
      { field: `<img src=x onerror=alert(1)>`, oldValue: "a", newValue: "b" },
    ]);
    assert.ok(!html.includes("<img"), "an image tag reached the message body");
  });

  it("keeps a multi-line guest name out of the subject header", () => {
    const { subject } = buildBookingUpdateEmail(42, "Rahul\r\nBcc: someone@elsewhere.test", []);
    assert.ok(!subject.includes("\n"), "a newline survived into the subject");
    assert.ok(!subject.includes("\r"), "a carriage return survived into the subject");
  });

  it("still renders the legitimate content", () => {
    const { html, text, subject } = buildBookingUpdateEmail(7, "Priya Sharma", [
      { field: "Status", oldValue: "confirmed", newValue: "checked_in" },
    ]);
    assert.ok(html.includes("Priya Sharma"));
    assert.ok(html.includes("checked_in"));
    assert.ok(subject.includes("Booking #7"));
    assert.ok(subject.includes("Priya Sharma"));
    assert.ok(text.includes("Status: confirmed -> checked_in"), text);
  });

  it("offers a plain-text alternative alongside the HTML", () => {
    const { text } = buildBookingUpdateEmail(1, injection, []);
    assert.ok(text.length > 0);
    assert.ok(!text.includes("<td"), "the text part should not carry HTML structure");
  });
});
