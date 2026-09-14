import { Router } from "express";
import multer from "multer";
import { db, bookingsTable, hotelsTable, agenciesTable } from "@workspace/db";
import { eq, and, between, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { gemini, pcmToWav } from "../lib/openai.js";
import { Type } from "@google/genai";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function calc(roomRent: number, addOns: number, receipt: number) {
  const totalCost = roomRent + addOns;
  return { totalCost, balance: totalCost - receipt };
}

function effectiveHotelId(reqUser: any, requestedHotelId?: number) {
  if (reqUser?.role === "admin") return requestedHotelId;
  return reqUser?.hotelId ?? undefined;
}

const functionDeclarations: any[] = [
  {
    name: "list_bookings",
    description: "List hotel bookings with optional filters. Returns array of bookings with guest, room, dates, cost, status, agency.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "Filter by check-in date (YYYY-MM-DD)" },
        month: { type: Type.INTEGER, description: "Month (1-12)" },
        year: { type: Type.INTEGER, description: "Year e.g. 2026" },
        status: { type: Type.STRING, enum: ["confirmed", "checked_in", "checked_out", "cancelled"] },
        agencyId: { type: Type.INTEGER },
        guestName: { type: Type.STRING, description: "Substring match on guest name" },
        limit: { type: Type.INTEGER, description: "Max results, default 50" },
      },
    },
  },
  {
    name: "get_booking",
    description: "Get a single booking by id with full details.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.INTEGER } }, required: ["id"] },
  },
  {
    name: "create_booking",
    description: "Create a new hotel booking. Required: guestName, checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), roomRent.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        guestName: { type: Type.STRING },
        guestEmail: { type: Type.STRING },
        guestPhone: { type: Type.STRING },
        numberOfRooms: { type: Type.INTEGER, description: "How many rooms booked. Default 1." },
        numberOfPersons: { type: Type.INTEGER, description: "How many persons. Default 1." },
        checkIn: { type: Type.STRING, description: "YYYY-MM-DD" },
        checkOut: { type: Type.STRING, description: "YYYY-MM-DD" },
        roomRent: { type: Type.NUMBER },
        addOns: { type: Type.NUMBER },
        receipt: { type: Type.NUMBER },
        notes: { type: Type.STRING },
        status: { type: Type.STRING, enum: ["confirmed", "checked_in", "checked_out", "cancelled"] },
        agencyId: { type: Type.INTEGER },
        hotelId: { type: Type.INTEGER, description: "Admin only" },
      },
      required: ["guestName", "checkIn", "checkOut", "roomRent"],
    },
  },
  {
    name: "update_booking",
    description: "Update an existing booking. Provide id and any fields to change.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.INTEGER },
        guestName: { type: Type.STRING },
        guestEmail: { type: Type.STRING },
        guestPhone: { type: Type.STRING },
        numberOfRooms: { type: Type.INTEGER },
        numberOfPersons: { type: Type.INTEGER },
        checkIn: { type: Type.STRING },
        checkOut: { type: Type.STRING },
        roomRent: { type: Type.NUMBER },
        addOns: { type: Type.NUMBER },
        receipt: { type: Type.NUMBER },
        notes: { type: Type.STRING },
        status: { type: Type.STRING, enum: ["confirmed", "checked_in", "checked_out", "cancelled"] },
        agencyId: { type: Type.INTEGER },
      },
      required: ["id"],
    },
  },
  {
    name: "occupancy_on_date",
    description: "Get occupied room count and total rooms for a specific date.",
    parameters: { type: Type.OBJECT, properties: { date: { type: Type.STRING, description: "YYYY-MM-DD" } }, required: ["date"] },
  },
  {
    name: "dashboard_stats",
    description: "Get current dashboard summary: today's check-ins, check-outs, occupancy, monthly revenue.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "revenue_summary",
    description: "Get revenue summary by month for a year, plus revenue grouped by agency.",
    parameters: { type: Type.OBJECT, properties: { year: { type: Type.INTEGER } } },
  },
  {
    name: "list_agencies",
    description: "List all agencies for the user's hotel.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "list_hotels",
    description: "List all hotels (admin only).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

async function executeTool(name: string, args: any, reqUser: any): Promise<any> {
  const myHotelId = effectiveHotelId(reqUser, args.hotelId);

  if (name === "list_bookings") {
    const conditions: any[] = [];
    if (myHotelId) conditions.push(eq(bookingsTable.hotelId, myHotelId));
    if (args.date) conditions.push(eq(bookingsTable.checkIn, args.date));
    if (args.month && args.year) {
      const m = args.month, y = args.year;
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0);
      const end = `${y}-${String(m).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      conditions.push(between(bookingsTable.checkIn, start, end));
    }
    if (args.status) conditions.push(eq(bookingsTable.status, args.status));
    if (args.agencyId) conditions.push(eq(bookingsTable.agencyId, args.agencyId));
    if (args.guestName) conditions.push(sql`LOWER(${bookingsTable.guestName}) LIKE LOWER(${'%' + args.guestName + '%'})`);
    const limit = args.limit ?? 50;
    const rows = conditions.length
      ? await db.select().from(bookingsTable).where(and(...conditions)).orderBy(desc(bookingsTable.checkIn)).limit(limit)
      : await db.select().from(bookingsTable).orderBy(desc(bookingsTable.checkIn)).limit(limit);
    return rows.map((b) => ({ ...b, roomRent: parseFloat(b.roomRent), addOns: parseFloat(b.addOns), totalCost: parseFloat(b.totalCost), receipt: parseFloat(b.receipt), balance: parseFloat(b.balance) }));
  }

  if (name === "get_booking") {
    const [b] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, args.id));
    if (!b) return { error: "Not found" };
    if (reqUser.role !== "admin" && b.hotelId !== reqUser.hotelId) return { error: "Forbidden" };
    return { ...b, roomRent: parseFloat(b.roomRent), addOns: parseFloat(b.addOns), totalCost: parseFloat(b.totalCost), receipt: parseFloat(b.receipt), balance: parseFloat(b.balance) };
  }

  if (name === "create_booking") {
    const targetHotelId = reqUser.role === "admin" ? (args.hotelId ?? reqUser.hotelId) : reqUser.hotelId;
    if (!targetHotelId) return { error: "hotelId required for admin" };
    const rr = Number(args.roomRent), ao = Number(args.addOns ?? 0), rc = Number(args.receipt ?? 0);
    const { totalCost, balance } = calc(rr, ao, rc);
    const [b] = await db.insert(bookingsTable).values({
      guestName: args.guestName,
      guestEmail: args.guestEmail ?? null,
      guestPhone: args.guestPhone ?? null,
      numberOfRooms: args.numberOfRooms ?? 1,
      numberOfPersons: args.numberOfPersons ?? 1,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      roomRent: String(rr),
      addOns: String(ao),
      totalCost: String(totalCost),
      receipt: String(rc),
      balance: String(balance),
      notes: args.notes ?? null,
      status: args.status ?? "confirmed",
      hotelId: targetHotelId,
      agencyId: args.agencyId ?? null,
    }).returning();
    return { success: true, booking: { ...b, roomRent: rr, addOns: ao, totalCost, receipt: rc, balance } };
  }

  if (name === "update_booking") {
    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, args.id));
    if (!existing) return { error: "Not found" };
    if (reqUser.role !== "admin" && existing.hotelId !== reqUser.hotelId) return { error: "Forbidden" };
    const rr = args.roomRent !== undefined ? Number(args.roomRent) : parseFloat(existing.roomRent);
    const ao = args.addOns !== undefined ? Number(args.addOns) : parseFloat(existing.addOns);
    const rc = args.receipt !== undefined ? Number(args.receipt) : parseFloat(existing.receipt);
    const { totalCost, balance } = calc(rr, ao, rc);
    const updates: any = {
      roomRent: String(rr), addOns: String(ao), totalCost: String(totalCost),
      receipt: String(rc), balance: String(balance), updatedAt: new Date(),
    };
    for (const k of ["guestName", "guestEmail", "guestPhone", "checkIn", "checkOut", "notes", "status", "agencyId"]) {
      if (args[k] !== undefined) updates[k] = args[k];
    }
    if (args.numberOfRooms !== undefined) updates.numberOfRooms = parseInt(String(args.numberOfRooms));
    if (args.numberOfPersons !== undefined) updates.numberOfPersons = parseInt(String(args.numberOfPersons));
    const [b] = await db.update(bookingsTable).set(updates).where(eq(bookingsTable.id, args.id)).returning();
    return { success: true, booking: { ...b, roomRent: rr, addOns: ao, totalCost, receipt: rc, balance } };
  }

  if (name === "occupancy_on_date") {
    const date = args.date;
    const conditions: any[] = [
      sql`${bookingsTable.checkIn} <= ${date}`,
      sql`${bookingsTable.checkOut} > ${date}`,
      sql`${bookingsTable.status} IN ('confirmed','checked_in')`,
    ];
    if (myHotelId) conditions.push(eq(bookingsTable.hotelId, myHotelId));
    const rows = await db.select().from(bookingsTable).where(and(...conditions));
    const occupiedRooms = rows.reduce((s, b) => s + (b.numberOfRooms ?? 1), 0);
    let totalRooms = 0;
    if (myHotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, myHotelId));
      totalRooms = h?.totalRooms ?? 0;
    } else {
      const hs = await db.select().from(hotelsTable);
      totalRooms = hs.reduce((s, h) => s + h.totalRooms, 0);
    }
    return {
      date,
      occupiedRooms,
      totalRooms,
      vacantRooms: Math.max(0, totalRooms - occupiedRooms),
      occupancyPercentage: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
      bookings: rows.map((b) => ({ id: b.id, guestName: b.guestName, numberOfRooms: b.numberOfRooms, numberOfPersons: b.numberOfPersons, checkIn: b.checkIn, checkOut: b.checkOut })),
    };
  }

  if (name === "dashboard_stats") {
    const today = new Date().toISOString().split("T")[0];
    const conditions: any[] = [];
    if (myHotelId) conditions.push(eq(bookingsTable.hotelId, myHotelId));
    const allBookings = conditions.length ? await db.select().from(bookingsTable).where(and(...conditions)) : await db.select().from(bookingsTable);
    const checkins = allBookings.filter((b) => b.checkIn === today).length;
    const checkouts = allBookings.filter((b) => b.checkOut === today).length;
    const occupied = allBookings.filter((b) => b.checkIn <= today! && b.checkOut > today! && (b.status === "confirmed" || b.status === "checked_in")).reduce((s, b) => s + (b.numberOfRooms ?? 1), 0);
    const month = new Date().getMonth() + 1, year = new Date().getFullYear();
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthRevenue = allBookings.filter((b) => b.checkIn >= monthStart).reduce((s, b) => s + parseFloat(b.totalCost), 0);
    let totalRooms = 0;
    if (myHotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, myHotelId));
      totalRooms = h?.totalRooms ?? 0;
    } else {
      const hs = await db.select().from(hotelsTable);
      totalRooms = hs.reduce((s, h) => s + h.totalRooms, 0);
    }
    return {
      today,
      todayCheckins: checkins,
      todayCheckouts: checkouts,
      occupiedRooms: occupied,
      totalRooms,
      occupancyPercentage: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
      monthlyRevenue: monthRevenue,
      totalBookings: allBookings.length,
    };
  }

  if (name === "revenue_summary") {
    const year = args.year ?? new Date().getFullYear();
    const conditions: any[] = [
      sql`EXTRACT(YEAR FROM ${bookingsTable.checkIn}) = ${year}`,
    ];
    if (myHotelId) conditions.push(eq(bookingsTable.hotelId, myHotelId));
    const rows = await db.select().from(bookingsTable).where(and(...conditions));
    const monthly: Record<number, { revenue: number; bookings: number }> = {};
    for (let m = 1; m <= 12; m++) monthly[m] = { revenue: 0, bookings: 0 };
    for (const b of rows) {
      const m = new Date(b.checkIn).getMonth() + 1;
      monthly[m]!.revenue += parseFloat(b.totalCost);
      monthly[m]!.bookings += 1;
    }
    const agencies = await db.select().from(agenciesTable);
    const agencyMap = new Map(agencies.map((a) => [a.id, a.name]));
    const byAgency: Record<string, { revenue: number; bookings: number }> = {};
    for (const b of rows) {
      const key = b.agencyId ? agencyMap.get(b.agencyId) ?? `Agency ${b.agencyId}` : "Direct";
      if (!byAgency[key]) byAgency[key] = { revenue: 0, bookings: 0 };
      byAgency[key].revenue += parseFloat(b.totalCost);
      byAgency[key].bookings += 1;
    }
    return {
      year,
      totalRevenue: rows.reduce((s, b) => s + parseFloat(b.totalCost), 0),
      monthlyRevenue: monthly,
      revenueByAgency: byAgency,
    };
  }

  if (name === "list_agencies") {
    const rows = myHotelId
      ? await db.select().from(agenciesTable).where(eq(agenciesTable.hotelId, myHotelId))
      : await db.select().from(agenciesTable);
    return rows;
  }

  if (name === "list_hotels") {
    if (reqUser.role !== "admin") return { error: "Admin only" };
    return await db.select().from(hotelsTable);
  }

  return { error: `Unknown tool: ${name}` };
}

router.post("/chat", requireAuth, async (req, res) => {
  try {
    const { messages = [] } = req.body as { messages: { role: string; content: string }[] };
    const reqUser = req.user!;
    const today = new Date().toISOString().split("T")[0];

    const systemInstruction = `You are a helpful AI assistant for a Hotel CRM platform. You can answer questions and perform tasks related to hotels, bookings, agencies, revenue and occupancy.

CONTEXT:
- Today's date: ${today}
- Current user: ${reqUser.email} (role: ${reqUser.role}${reqUser.hotelId ? `, hotelId: ${reqUser.hotelId}` : ""})
- Currency: Indian Rupee (₹)

CAPABILITIES:
- View bookings, agencies, hotels, revenue, occupancy via tools
- Create new bookings and update existing ones via tools
- Answer questions about who is checking in, occupancy on any date, revenue, agency performance, etc.

LANGUAGE:
- The user may write in English, Hindi, Hinglish or any Indian language. Reply in the same language they used.
- For Hindi, use Devanagari script unless the user uses Roman script.

GUIDELINES:
- Always use the provided tools to look up real data — never invent booking details, room numbers, or revenue.
- For dates the user mentions (e.g. "tomorrow", "next Monday", "15th"), interpret them relative to today (${today}) and use YYYY-MM-DD format when calling tools.
- When creating a booking, if the user does not provide all required fields (guestName, checkIn, checkOut, roomRent), ask one short follow-up question.
- Format money as ₹X,XXX. Keep responses concise and friendly.
- After performing an action (create/update), confirm what changed in one short sentence.`;

    const contents: any[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    let safety = 0;
    let finalText = "";
    while (safety < 6) {
      safety++;
      const response: any = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations }],
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const functionCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

      if (functionCalls.length === 0) {
        finalText = response.text ?? parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n") ?? "";
        break;
      }

      contents.push({ role: "model", parts });
      const responseParts: any[] = [];
      for (const fc of functionCalls) {
        const result = await executeTool(fc.name, fc.args || {}, reqUser);
        responseParts.push({
          functionResponse: { name: fc.name, response: { result } },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    res.json({ reply: finalText || "Sorry, I couldn't generate a response." });
  } catch (e: any) {
    console.error("[ai/chat]", e);
    res.status(500).json({ error: "AI error", message: e?.message ?? String(e) });
  }
});

router.post("/tts", requireAuth, async (req, res) => {
  try {
    const { text, voice = "Kore" } = req.body as { text: string; voice?: string };
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const response: any = await gemini.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text.slice(0, 4000) }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });
    const inline = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
    if (!inline?.data) throw new Error("No audio returned");
    const wav = pcmToWav(inline.data);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(wav.length));
    res.send(wav);
  } catch (e: any) {
    console.error("[ai/tts]", e);
    res.status(500).json({ error: "TTS error", message: e?.message ?? String(e) });
  }
});

router.post("/stt", requireAuth, upload.single("audio"), async (req: any, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "audio file required" });
      return;
    }
    const mimeType = req.file.mimetype || "audio/webm";
    const data = req.file.buffer.toString("base64");
    const response: any = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        parts: [
          { text: "Transcribe this audio. Return ONLY the spoken text — no explanations, no quotes, no formatting. Preserve the original language (Hindi in Devanagari, English, etc.)." },
          { inlineData: { mimeType, data } },
        ],
      }],
    });
    const text = (response.text ?? "").trim();
    res.json({ text });
  } catch (e: any) {
    console.error("[ai/stt]", e);
    res.status(500).json({ error: "STT error", message: e?.message ?? String(e) });
  }
});

export default router;
