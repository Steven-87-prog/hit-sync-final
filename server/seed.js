// Populates a few demo players so Find Players / Find Friends / Friends
// have something to show right after you clone the repo. Run with: npm run seed
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { hydrate, load, save, nextId } = require("./db");

async function seed() {
  await hydrate();
  const data = load();

  if (data.users.length > 0) {
    console.log("Database already has users — skipping seed. Delete data/db.json to reseed (or clear your remote store).");
    return;
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  const demoUsers = [
    {
      name: "Ava Chen",
      email: "ava@example.com",
      zip: "75201",
      lat: 32.7831,
      lng: -96.8067,
      utr: 8.5,
      usta: "4.5",
      surface: "Hard",
      handedness: "Right",
      style: "Aggressive baseliner",
      bio: "Playing competitively for 6 years, looking for consistent hitting partners around Dallas.",
      availability: [
        { day: "Tue", start: "16:00", end: "18:00" },
        { day: "Thu", start: "17:00", end: "19:00" },
        { day: "Sat", start: "09:00", end: "12:00" },
      ],
      paidHits: { enabled: false, rate: null, method: "" },
    },
    {
      name: "Marcus Lee",
      email: "marcus@example.com",
      zip: "75204",
      lat: 32.8046,
      lng: -96.7970,
      utr: 9.1,
      usta: "5.0",
      surface: "Hard",
      handedness: "Left",
      style: "Serve and volley",
      bio: "Former college player. Offering paid hits for players looking to level up quickly.",
      availability: [
        { day: "Tue", start: "17:00", end: "19:00" },
        { day: "Sat", start: "10:00", end: "13:00" },
      ],
      paidHits: { enabled: true, rate: 45, method: "Venmo" },
    },
    {
      name: "Priya Patel",
      email: "priya@example.com",
      zip: "75098",
      lat: 33.0151,
      lng: -96.5389,
      utr: 6.2,
      usta: "3.5",
      surface: "Clay",
      handedness: "Right",
      style: "Consistent counterpuncher",
      bio: "Getting back into tennis after a few years off. Friendly rallies welcome!",
      availability: [
        { day: "Wed", start: "18:00", end: "20:00" },
        { day: "Sun", start: "14:00", end: "16:00" },
      ],
      paidHits: { enabled: false, rate: null, method: "" },
    },
    {
      name: "Diego Ramirez",
      email: "diego@example.com",
      zip: "75035",
      lat: 33.1507,
      lng: -96.8236,
      utr: 5.4,
      usta: "3.0",
      surface: "Hard",
      handedness: "Right",
      style: "All-court player",
      bio: "Casual player, mostly weekends. Happy to hit with anyone around my level.",
      availability: [
        { day: "Sat", start: "09:00", end: "11:00" },
        { day: "Sun", start: "09:00", end: "11:00" },
      ],
      paidHits: { enabled: false, rate: null, method: "" },
    },
  ];

  for (const u of demoUsers) {
    data.users.push({
      id: nextId(data, "users"),
      passwordHash,
      location: "",
      friends: [],
      tutorialSeen: true, // demo accounts skip the onboarding tour
      createdAt: new Date().toISOString(),
      ...u,
    });
  }

  save(data);
  console.log(`Seeded ${demoUsers.length} demo players, password for all: password123`);
  demoUsers.forEach((u) => console.log(`  - ${u.email}`));
}

seed();
