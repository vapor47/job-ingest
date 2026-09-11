import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchBoard, htmlToText } from "./ats.ts";
import { rawPostingSchema, type Ats } from "../schema/job-posting.ts";

// Live boards, one per ATS. These hit the network on a cold cache and are the point of
// the test: a silent response-shape change is exactly what a mocked test would miss.
const BOARDS: [Ats, string][] = [
  ["greenhouse", "affirm"],
  ["lever", "captivateiq"],
  ["ashby", "abridge"],
];

for (const [ats, token] of BOARDS) {
  test(`${ats}: live board returns schema-conforming postings`, async () => {
    const postings = await fetchBoard(token, ats);
    assert.ok(postings.length > 0, `${token} returned no postings`);

    for (const p of postings) rawPostingSchema.parse(p);
    assert.equal(postings[0].ats, ats);

    // Descriptions are the extractor's only input; empty ones mean the parser missed a field.
    const empty = postings.filter((p) => p.description.length < 200);
    assert.ok(empty.length / postings.length < 0.1, `${empty.length}/${postings.length} thin descriptions`);
    assert.ok(!postings[0].description.includes("<"), "description still contains markup");
  });
}

test("an empty board is a valid result, not a failure", async () => {
  assert.deepEqual(await fetchBoard("anjuna", "lever"), []);
});

test("a dead token throws rather than reporting an empty board", async () => {
  await assert.rejects(() => fetchBoard("definitelynotaboard0x", "greenhouse"), /404/);
});

test("htmlToText strips markup and decodes entities", () => {
  const greenhouseStyle = "&lt;p&gt;Requirements&lt;/p&gt;&lt;li&gt;5+ years &amp;amp; Go&lt;/li&gt;";
  // Greenhouse escapes its HTML once on the wire, so one decode reveals the tags.
  const text = htmlToText(htmlToText(greenhouseStyle));
  assert.equal(text, "Requirements\n5+ years & Go");
});
