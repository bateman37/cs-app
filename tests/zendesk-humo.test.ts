import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshEnvironment, removeUploadDir, useUploadDir } from "./cargas-helpers";
import { ticketsBuffer, ticket, timeRow, timesBuffer } from "./generators/zendesk";
import { count, entries, importZd, sumHours, TICKETS, TIEMPO, ticketCurrent } from "./zendesk-helpers";

let dir: string;
let admin: { id: string };
beforeAll(() => { dir = useUploadDir(); });
afterAll(() => removeUploadDir(dir));
beforeEach(async () => { ({ admin } = await freshEnvironment()); });

describe("humo", () => {
  it("importa tickets y tiempos de extremo a extremo", async () => {
    await importZd(admin.id, TICKETS, await ticketsBuffer([ticket(), ticket({ ticket_id: "1002", status: "solved" })]));
    expect(await count("ZdTicket")).toBe(2);
    expect((await ticketCurrent("1001"))?.status).toBe("open");
    await importZd(admin.id, TIEMPO, await timesBuffer([timeRow(), timeRow({ logged_hours: 0, logged_minutes: 5 })]));
    expect(await count("ZdTimeEntry")).toBe(2);
    expect(await sumHours()).toBeCloseTo(1.5 + 5 / 60, 9);
    console.log(await entries());
  });
});
