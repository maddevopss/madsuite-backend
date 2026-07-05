const request = require("supertest");
const app = require("../app");

const sensitiveRoutes = [
  ["GET", "/api/organisation/health"],
  ["GET", "/api/organisations"],
  ["GET", "/api/organisation/modules"],
  ["GET", "/api/hub/projects"],
  ["POST", "/api/master-admin/organisations"],
  ["GET", "/api/system/health"],
];

describe("sensitive route mounts require authentication", () => {
  test.each(sensitiveRoutes)("%s %s rejects anonymous requests", async (method, path) => {
    const agent = request(app);
    const req = method === "POST" ? agent.post(path).send({}) : agent.get(path);
    const res = await req;

    expect(res.status).toBe(401);
  });
});
