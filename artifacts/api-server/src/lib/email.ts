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

  const changesHtml = changes
    .map(
      (c) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #e0e0e0; font-weight: bold;">${c.field}</td>
      <td style="padding: 8px; border: 1px solid #e0e0e0; color: #e53e3e;">${c.oldValue}</td>
      <td style="padding: 8px; border: 1px solid #e0e0e0; color: #38a169;">${c.newValue}</td>
    </tr>
  `
    )
    .join("");

  const html = `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f7fafc; border-radius: 8px;">
      <h2 style="color: #1a365d; margin-bottom: 16px;">Booking Update Notification</h2>
      <p style="color: #4a5568;">Booking #${bookingId} for <strong>${guestName}</strong> has been updated.</p>
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

  try {
    await transporter.sendMail({
      from: process.env["SMTP_USER"],
      to: ownerEmail,
      subject: `Booking #${bookingId} Updated - ${guestName}`,
      html,
    });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
