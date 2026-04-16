import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
});

interface Template {
  name: string;
  notes: string[];
}

const TEMPLATES: Template[] = [
  {
    name: "Creative Writing Prompts",
    notes: [
      "Write a story that begins with a sound",
      "Describe a place you've never been",
      "A character finds a letter they wrote 10 years ago",
      "Two strangers share an umbrella",
      "Write from the perspective of an object in the room",
      "A conversation overheard on a train",
      "The last day of something",
      "A gift that changes everything",
      "Write about a color without naming it",
      "A door that shouldn't be there",
    ],
  },
  {
    name: "Date Night Ideas",
    notes: [
      "Cook a new cuisine together",
      "Picnic in the park",
      "Visit a bookstore and pick books for each other",
      "Movie marathon with homemade popcorn",
      "Take a dance class",
      "Sunset walk",
      "Board game tournament",
      "Try a new restaurant neither has been to",
      "Stargazing",
      "Build something together (puzzle, LEGO, furniture)",
    ],
  },
  {
    name: "Icebreaker Questions",
    notes: [
      "What's the best meal you've ever had?",
      "If you could live anywhere, where would it be?",
      "What's a skill you'd love to learn?",
      "What's the most interesting thing you've read recently?",
      "If you could have dinner with anyone, who?",
      "What's your go-to comfort activity?",
      "What's something you're proud of?",
      "If you had a theme song, what would it be?",
      "What's your unpopular opinion?",
      "What made you smile today?",
    ],
  },
  {
    name: "Sprint Retrospective",
    notes: [
      "What went well this sprint?",
      "What could we improve?",
      "What should we start doing?",
      "What should we stop doing?",
      "What was the biggest blocker?",
      "Who helped you this sprint?",
      "What surprised you?",
      "What are you most proud of?",
      "What do you want to learn next?",
      "Rate this sprint 1-10 and why",
    ],
  },
  {
    name: "Party Dares",
    notes: [
      "Do your best impression of someone in the room",
      "Speak in an accent for the next 3 minutes",
      "Show the last photo on your phone",
      "Do 10 pushups",
      "Sing the chorus of the last song you listened to",
      "Let the group post a story on your social media",
      "Call a friend and sing happy birthday",
      "Speak without using the letter E for 1 minute",
      "Do your best dance move",
      "Tell an embarrassing story",
    ],
  },
];

async function seed(): Promise<void> {
  // Create a system user for templates
  const {
    rows: [systemUser],
  } = await pool.query(
    `INSERT INTO users (display_name, email)
     VALUES ('Cookie Jar', 'templates@cookiejar.app')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Cookie Jar'
     RETURNING *`,
  );

  for (const template of TEMPLATES) {
    // Check if template already exists
    const { rows: existing } = await pool.query(
      "SELECT id FROM jars WHERE name = $1 AND is_template = true",
      [template.name],
    );

    if (existing.length > 0) {
      console.log(`Template "${template.name}" already exists, skipping`);
      continue;
    }

    const {
      rows: [jar],
    } = await pool.query(
      `INSERT INTO jars (owner_id, name, is_template, is_public, config)
       VALUES ($1, $2, true, true, $3)
       RETURNING *`,
      [
        systemUser.id,
        template.name,
        JSON.stringify({
          noteVisibility: "open",
          pullVisibility: "shared",
          sealedRevealCount: 1,
          showAuthors: false,
          showPulledBy: false,
        }),
      ],
    );

    for (const text of template.notes) {
      await pool.query("INSERT INTO notes (jar_id, text, style) VALUES ($1, $2, 'sticky')", [
        jar.id,
        text,
      ]);
    }

    console.log(`Seeded template "${template.name}" with ${template.notes.length} notes`);
  }

  await pool.end();
  console.log("Done seeding templates");
}

seed().catch(console.error);
