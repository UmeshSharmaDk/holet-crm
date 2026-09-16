import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env["SMTP_HOST"] ?? "smtp.gmail.com",
  port: parseInt(process.env["SMTP_PORT"] ?? "587"),
  secure: false,
  auth: {
    user: process.env["SMTP_USER"],
    pass: process.env["SMTP_PASS"],
  },
});

export interface BookingComparison {
  field: string;
  oldValue: string;
  newValue: string;
}

/**
 * Escapes text for an HTML context.
 *
 * Everything interpolated into these templates is plain text written by CRM
 * users — guest names, field values — and none of it is meant to carry markup.
 * Interpolating it raw let anyone who could name a booking put live markup in
 * an email sent from the CRM's own address to hotel owners, which is a phishing
 * primitive handed to any manager account.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses whitespace so a multi-line value cannot break up a header. */
function headerSafe(value: unknown, max = 200): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface BookingUpdateEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Builds the booking-update message. Separated from sending so the escaping is
 * verifiable without SMTP.
 */
export function buildBookingUpdateEmail(
  bookingId: number,
  guestName: string,
  changes: BookingComparison[],
): BookingUpdateEmail {
  const safeGuestName = escapeHtml(guestName);

  const changesHtml = changes
    .map(
      (c) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #e0e0e0; font-weight: bold;">${escapeHtml(c.field)}</td>
      <td style="padding: 8px; border: 1px solid #e0e0e0; color: #e53e3e;">${escapeHtml(c.oldValue)}</td>
      <td style="padding: 8px; border: 1px solid #e0e0e0; color: #38a169;">${escapeHtml(c.newValue)}</td>
    </tr>
  `,
    )
    .join("");

  const html = `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f7fafc; border-radius: 8px;">
      <h2 style="color: #1a365d; margin-bottom: 16px;">Booking Update Notification</h2>
      <p style="color: #4a5568;">Booking #${bookingId} for <strong>${safeGuestName}</strong> has been updated.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; background: white; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background: #2d3748; color: white;">
            <th style="padding: 10px; text-align: left;">Field</th>
            <th style="padding: 10px; text-align: left;">Old Value</th>
            <th style="padding: 10px; text-align: left;">New Value</th>
          </tr>
        </thead>
        <tbody>
          ${changesHtml}
        </tbody>
      </table>
      <p style="color: #718096; margin-top: 16px; font-size: 12px;">This is an automated notification from Hotel CRM.</p>
    </div>
  `;

  // A plain-text alternative, so a client that prefers text never renders
  // markup at all.
  const text = [
    `Booking #${bookingId} for ${String(guestName ?? "")} has been updated.`,
    "",
    ...changes.map((c) => `- ${c.field}: ${c.oldValue} -> ${c.newValue}`),
    "",
    "This is an automated notification from Hotel CRM.",
  ].join("\n");

  return {
    subject: `Booking #${bookingId} Updated - ${headerSafe(guestName)}`,
    html,
    text,
  };
}

export async function sendBookingUpdateEmail(
  ownerEmail: string,
  bookingId: number,
  guestName: string,
  changes: BookingComparison[]
): Promise<void> {
  if (!process.env["SMTP_USER"] || !process.env["SMTP_PASS"]) {
    console.log("SMTP not configured, skipping email for booking update", bookingId);
    return;
  }

  const { subject, html, text } = buildBookingUpdateEmail(bookingId, guestName, changes);

  try {
    await transporter.sendMail({
      from: process.env["SMTP_USER"],
      to: ownerEmail,
      subject,
      html,
      text,
    });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
