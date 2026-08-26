import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const CREATOR_EMAIL = (
  process.env.CREATOR_EMAIL || "awudumohammedmodoo@gmail.com"
).toLowerCase();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_URL === "*" ? "*" : FRONTEND_URL,
    credentials: FRONTEND_URL !== "*",
  })
);

app.use(express.json({ limit: "5mb" }));

/* ============================================================
   PASSCOGH-MODOO
   EDUCATION PLATFORM BACKEND
   ============================================================ */

/*
  IMPORTANT:
  This version provides the API foundation.

  Later, persistent users, PDFs, payments, courses and
  certificates should be moved from memory into PostgreSQL.
*/

/* ============================================================
   HELPERS
   ============================================================ */

function makeId(prefix = "PASS") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isCreator(email) {
  return normalizeEmail(email) === CREATOR_EMAIL;
}

function findPdf(id) {
  return pdfLibrary.find((pdf) => pdf.id === id);
}

function findCourse(id) {
  return courses.find((course) => course.id === id);
}

/* ============================================================
   ACADEMIC SUBJECT STRUCTURE
   ============================================================ */

const subjects = [
  {
    id: "biology",
    name: "Biology",
    level: "SHS",
    sections: [
      "Notes",
      "Theory Past Questions",
      "Theory Answers",
      "Practical Past Questions",
      "Practical Answers",
      "Practical Guide",
      "Diagrams",
      "Exam Guide",
      "Likely Questions",
    ],
  },
  {
    id: "chemistry",
    name: "Chemistry",
    level: "SHS",
    sections: [
      "Notes",
      "Theory Past Questions",
      "Theory Answers",
      "Practical Past Questions",
      "Practical Answers",
      "Practical Guide",
      "Experiments",
      "Calculations",
      "Exam Guide",
      "Likely Questions",
    ],
  },
  {
    id: "physics",
    name: "Physics",
    level: "SHS",
    sections: [
      "Notes",
      "Theory Past Questions",
      "Theory Answers",
      "Practical Past Questions",
      "Practical Answers",
      "Practical Guide",
      "Experiments",
      "Calculations",
      "Exam Guide",
      "Likely Questions",
    ],
  },
  {
    id: "mathematics",
    name: "Mathematics",
    level: "SHS",
    sections: [
      "Notes",
      "Worked Examples",
      "Theory Past Questions",
      "Answers",
      "Likely Questions",
      "Exam Guide",
    ],
  },
  {
    id: "english",
    name: "English Language",
    level: "SHS",
    sections: [
      "Notes",
      "Comprehension",
      "Summary",
      "Essay",
      "Oral English",
      "Past Questions",
      "Answers",
      "Exam Guide",
    ],
  },
  {
    id: "social-studies",
    name: "Social Studies",
    level: "SHS",
    sections: [
      "Notes",
      "Past Questions",
      "Answers",
      "Likely Questions",
      "Essay Guide",
      "Exam Guide",
    ],
  },
  {
    id: "geography",
    name: "Geography",
    level: "SHS",
    sections: [
      "Notes",
      "Map Work",
      "Practical Questions",
      "Theory Questions",
      "Answers",
      "Diagrams",
      "Exam Guide",
    ],
  },
  {
    id: "economics",
    name: "Economics",
    level: "SHS",
    sections: [
      "Notes",
      "Diagrams",
      "Calculations",
      "Past Questions",
      "Answers",
      "Likely Questions",
      "Exam Guide",
    ],
  },
  {
    id: "government",
    name: "Government",
    level: "SHS",
    sections: [
      "Notes",
      "Past Questions",
      "Answers",
      "Essay Guide",
      "Likely Questions",
      "Exam Guide",
    ],
  },
  {
    id: "ict",
    name: "ICT",
    level: "SHS",
    sections: [
      "Notes",
      "Practical Questions",
      "Theory Questions",
      "Answers",
      "Practical Guide",
      "Exam Guide",
    ],
  },
];

/* ============================================================
   COURSE CATALOGUE
   GH₵20 EACH
   ============================================================ */

const courses = [
  {
    id: "course-coding",
    title: "Coding Fundamentals",
    category: "Technology",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn programming fundamentals, problem solving, variables, conditions, loops and functions.",
    skills: [
      "Programming fundamentals",
      "Problem solving",
      "Algorithms",
      "Variables",
      "Conditions",
      "Loops",
      "Functions",
    ],
  },
  {
    id: "course-web-development",
    title: "Web Development",
    category: "Technology",
    priceGHS: 20,
    duration: "6 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn how websites are built using HTML, CSS and JavaScript.",
    skills: [
      "HTML",
      "CSS",
      "JavaScript",
      "Responsive design",
      "Web publishing",
    ],
  },
  {
    id: "course-python",
    title: "Python Programming",
    category: "Technology",
    priceGHS: 20,
    duration: "6 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Build a strong foundation in Python programming and automation.",
    skills: [
      "Python syntax",
      "Functions",
      "Lists",
      "Dictionaries",
      "Files",
      "Basic automation",
    ],
  },
  {
    id: "course-javascript",
    title: "JavaScript Essentials",
    category: "Technology",
    priceGHS: 20,
    duration: "5 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn JavaScript for interactive and modern websites.",
    skills: [
      "Variables",
      "Functions",
      "Arrays",
      "Objects",
      "DOM",
      "Events",
    ],
  },
  {
    id: "course-digital-skills",
    title: "Digital Skills for the Modern World",
    category: "Digital Skills",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Build practical digital skills for school, work and everyday life.",
    skills: [
      "Internet research",
      "Digital communication",
      "Online safety",
      "Productivity tools",
      "Digital professionalism",
    ],
  },
  {
    id: "course-ai-literacy",
    title: "Artificial Intelligence Literacy",
    category: "Technology",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Understand AI, responsible AI use, prompting and practical AI tools.",
    skills: [
      "AI fundamentals",
      "Prompting",
      "AI productivity",
      "Responsible AI",
      "AI research",
    ],
  },
  {
    id: "course-data-analysis",
    title: "Data Analysis Fundamentals",
    category: "Technology",
    priceGHS: 20,
    duration: "5 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn how to organise, analyse and communicate information from data.",
    skills: [
      "Data cleaning",
      "Spreadsheets",
      "Charts",
      "Basic statistics",
      "Data presentation",
    ],
  },
  {
    id: "course-cybersecurity",
    title: "Cybersecurity Awareness",
    category: "Technology",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn practical cybersecurity principles for protecting accounts and devices.",
    skills: [
      "Passwords",
      "Phishing awareness",
      "Privacy",
      "Device security",
      "Online safety",
    ],
  },
  {
    id: "course-graphic-design",
    title: "Graphic Design Fundamentals",
    category: "Creative Skills",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn design principles for posters, social media graphics and educational materials.",
    skills: [
      "Composition",
      "Typography",
      "Colour principles",
      "Branding",
      "Digital graphics",
    ],
  },
  {
    id: "course-video-editing",
    title: "Video Editing Fundamentals",
    category: "Creative Skills",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn the fundamentals of editing educational and social media videos.",
    skills: [
      "Video cutting",
      "Transitions",
      "Audio",
      "Captions",
      "Storytelling",
    ],
  },
  {
    id: "course-digital-marketing",
    title: "Digital Marketing",
    category: "Business",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn practical digital marketing concepts for online projects and businesses.",
    skills: [
      "Content strategy",
      "Social media",
      "Audience research",
      "Branding",
      "Digital campaigns",
    ],
  },
  {
    id: "course-entrepreneurship",
    title: "Entrepreneurship Fundamentals",
    category: "Business",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn how to identify opportunities and develop practical business ideas.",
    skills: [
      "Idea generation",
      "Market research",
      "Business models",
      "Customer needs",
      "Basic planning",
    ],
  },
  {
    id: "course-financial-literacy",
    title: "Personal Financial Literacy",
    category: "Finance",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn budgeting, saving, responsible spending and basic financial planning.",
    skills: [
      "Budgeting",
      "Saving",
      "Financial goals",
      "Responsible spending",
      "Basic planning",
    ],
  },
  {
    id: "course-public-speaking",
    title: "Public Speaking & Communication",
    category: "Personal Development",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Build confidence in speaking, presenting and communicating ideas.",
    skills: [
      "Presentation",
      "Confidence",
      "Speech structure",
      "Body language",
      "Communication",
    ],
  },
  {
    id: "course-study-skills",
    title: "Study Skills & Exam Mastery",
    category: "Education",
    priceGHS: 20,
    duration: "2 weeks",
    level: "All learners",
    certificate: true,
    featured: true,
    description:
      "Learn smarter revision, time management, active recall and examination strategies.",
    skills: [
      "Active recall",
      "Spaced repetition",
      "Time management",
      "Revision planning",
      "Exam strategy",
    ],
  },
  {
    id: "course-research",
    title: "Academic Research Skills",
    category: "Education",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Intermediate",
    certificate: true,
    featured: true,
    description:
      "Learn how to find, evaluate, organise and present academic information.",
    skills: [
      "Research questions",
      "Source evaluation",
      "Note taking",
      "Citation basics",
      "Academic writing",
    ],
  },
  {
    id: "course-english-writing",
    title: "Professional English & Writing",
    category: "Communication",
    priceGHS: 20,
    duration: "4 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Improve written communication for school, applications and professional settings.",
    skills: [
      "Grammar",
      "Professional writing",
      "Emails",
      "Reports",
      "Clear communication",
    ],
  },
  {
    id: "course-freelancing",
    title: "Freelancing & Online Work Fundamentals",
    category: "Career",
    priceGHS: 20,
    duration: "3 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Understand how digital skills can be presented and offered as freelance services.",
    skills: [
      "Skill selection",
      "Portfolio basics",
      "Client communication",
      "Professional profiles",
      "Online work safety",
    ],
  },
  {
    id: "course-career",
    title: "Career Readiness",
    category: "Career",
    priceGHS: 20,
    duration: "3 weeks",
    level: "All learners",
    certificate: true,
    featured: true,
    description:
      "Prepare for opportunities with CV, interview, communication and professional skills.",
    skills: [
      "CV basics",
      "Interview preparation",
      "Professional communication",
      "Goal setting",
      "Career planning",
    ],
  },
  {
    id: "course-ui-ux",
    title: "UI/UX Design Fundamentals",
    category: "Technology",
    priceGHS: 20,
    duration: "5 weeks",
    level: "Beginner",
    certificate: true,
    featured: true,
    description:
      "Learn the principles behind designing useful and user-friendly digital experiences.",
    skills: [
      "User research",
      "Wireframes",
      "Design principles",
      "Prototyping",
      "Usability",
    ],
  },
];

/* ============================================================
   PDF LIBRARY
   ============================================================ */

const pdfLibrary = [
  {
    id: "biology-revision-001",
    title: "Biology Complete Revision Pack",
    subject: "Biology",
    level: "SHS",
    type: "Theory + Practical",
    priceGHS: 10,
    readingFree: true,
    downloadPaid: true,
    copyright:
      "© PASSCOGH-MODOO. Educational material. All rights reserved.",
  },
  {
    id: "chemistry-revision-001",
    title: "Chemistry Complete Revision Pack",
    subject: "Chemistry",
    level: "SHS",
    type: "Theory + Practical",
    priceGHS: 10,
    readingFree: true,
    downloadPaid: true,
    copyright:
      "© PASSCOGH-MODOO. Educational material. All rights reserved.",
  },
  {
    id: "physics-revision-001",
    title: "Physics Complete Revision Pack",
    subject: "Physics",
    level: "SHS",
    type: "Theory + Practical",
    priceGHS: 10,
    readingFree: true,
    downloadPaid: true,
    copyright:
      "© PASSCOGH-MODOO. Educational material. All rights reserved.",
  },
];

/* ============================================================
   IN-MEMORY TRANSACTION DATA
   ============================================================ */

const payments = new Map();
const readingSessions = new Map();
const certificates = new Map();
const courseEnrollments = new Map();

/* ============================================================
   HOME
   ============================================================ */

app.get("/", (req, res) => {
  res.json({
    name: "PASSCOGH-MODOO",
    status: "online",
    version: "4.0.0",
    message: "Ghanaian learning, revision and skills platform.",
  });
});

/* ============================================================
   HEALTH
   ============================================================ */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "PASSCOGH-MODOO",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/* ============================================================
   API INFORMATION
   ============================================================ */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "PASSCOGH-MODOO",
    version: "4.0.0",
    features: [
      "Free online learning",
      "Theory preparation",
      "Practical preparation",
      "Past questions",
      "Answers",
      "Exam guides",
      "Individual PDF downloads",
      "15-minute advertising sessions",
      "Skills courses",
      "Course certificates",
      "Creator free access",
      "Payment integration",
    ],
  });
});

/* ============================================================
   SUBJECTS
   ============================================================ */

app.get("/api/subjects", (req, res) => {
  res.json({
    success: true,
    subjects,
  });
});

app.get("/api/subjects/:id", (req, res) => {
  const subject = subjects.find((item) => item.id === req.params.id);

  if (!subject) {
    return res.status(404).json({
      success: false,
      message: "Subject not found.",
    });
  }

  res.json({
    success: true,
    subject,
  });
});

/* ============================================================
   PDF LIST
   ============================================================ */

app.get("/api/pdfs", (req, res) => {
  res.json({
    success: true,
    count: pdfLibrary.length,
    pdfs: pdfLibrary.map((pdf) => ({
      ...pdf,
      onlineReading: "FREE",
      download:
        isCreator(req.headers["x-user-email"])
          ? "FREE FOR CREATOR"
          : `GH₵${pdf.priceGHS}`,
    })),
  });
});

/* ============================================================
   SINGLE PDF
   ============================================================ */

app.get("/api/pdfs/:id", (req, res) => {
  const pdf = findPdf(req.params.id);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found.",
    });
  }

  const creator = isCreator(req.headers["x-user-email"]);

  res.json({
    success: true,
    pdf,
    access: {
      readOnline: true,
      downloadFree: creator,
      downloadPriceGHS: creator ? 0 : pdf.priceGHS,
      copyright: pdf.copyright,
    },
  });
});

/* ============================================================
   FREE PDF READING SESSION
   ============================================================ */

app.post("/api/reading/start", (req, res) => {
  const { pdfId, email } = req.body;

  const pdf = findPdf(pdfId);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found.",
    });
  }

  const sessionId = makeId("READ");

  const creator = isCreator(email);

  readingSessions.set(sessionId, {
    sessionId,
    pdfId,
    email: normalizeEmail(email),
    creator,
    startedAt: Date.now(),
    advertisementIntervalMinutes: 15,
  });

  res.json({
    success: true,
    sessionId,
    pdfId,
    onlineReading: "FREE",
    advertisementIntervalMinutes: creator ? null : 15,
    advertisementsEnabled: !creator,
  });
});

/* ============================================================
   READING SESSION STATUS
   ============================================================ */

app.get("/api/reading/:sessionId", (req, res) => {
  const session = readingSessions.get(req.params.sessionId);

  if (!session) {
    return res.status(404).json({
      success: false,
      message: "Reading session not found.",
    });
  }

  const elapsedMinutes = Math.floor(
    (Date.now() - session.startedAt) / 60000
  );

  const shouldShowAd =
    !session.creator &&
    elapsedMinutes > 0 &&
    elapsedMinutes % 15 === 0;

  res.json({
    success: true,
    elapsedMinutes,
    advertisementsEnabled: !session.creator,
    showAdvertisement: shouldShowAd,
    nextAdvertisementInMinutes:
      session.creator
        ? null
        : 15 - (elapsedMinutes % 15),
  });
});

/* ============================================================
   COURSE LIST
   ============================================================ */

app.get("/api/courses", (req, res) => {
  res.json({
    success: true,
    priceGHS: 20,
    certificateType: "PASSCOGH-MODOO Certificate of Completion",
    count: courses.length,
    courses,
  });
});

/* ============================================================
   COURSE DETAILS
   ============================================================ */

app.get("/api/courses/:id", (req, res) => {
  const course = findCourse(req.params.id);

  if (!course) {
    return res.status(404).json({
      success: false,
      message: "Course not found.",
    });
  }

  res.json({
    success: true,
    course,
    priceGHS: course.priceGHS,
    certificateAvailable: course.certificate,
  });
});

/* ============================================================
   COURSE PAYMENT
   ============================================================ */

app.post("/api/payments/course", async (req, res) => {
  try {
    const { courseId, email } = req.body;

    const course = findCourse(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    if (isCreator(email)) {
      return res.json({
        success: true,
        creator: true,
        paymentRequired: false,
        enrolled: true,
        message: "Creator access granted.",
      });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message:
          "Payment system is not configured yet. Add PAYSTACK_SECRET_KEY in Render.",
      });
    }

    const reference = makeId("COURSE");

    const amount = Math.round(course.priceGHS * 100);

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: String(amount),
          currency: "GHS",
          reference,
          metadata: {
            productType: "course",
            courseId: course.id,
            courseTitle: course.title,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(400).json({
        success: false,
        message: "Course payment initialization failed.",
      });
    }

    payments.set(reference, {
      reference,
      type: "course",
      courseId,
      email: normalizeEmail(email),
      amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      paymentRequired: true,
      reference,
      courseId,
      courseTitle: course.title,
      amountGHS: course.priceGHS,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Course payment could not be initialized.",
    });
  }
});

/* ============================================================
   PDF PAYMENT
   ============================================================ */

app.post("/api/payments/pdf", async (req, res) => {
  try {
    const { pdfId, email } = req.body;

    const pdf = findPdf(pdfId);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF not found.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    if (isCreator(email)) {
      return res.json({
        success: true,
        creator: true,
        paymentRequired: false,
        downloadAllowed: true,
      });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message:
          "Payment system is not configured yet. Add PAYSTACK_SECRET_KEY in Render.",
      });
    }

    const reference = makeId("PDF");

    const amount = Math.round(pdf.priceGHS * 100);

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: String(amount),
          currency: "GHS",
          reference,
          metadata: {
            productType: "pdf",
            pdfId: pdf.id,
            pdfTitle: pdf.title,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(400).json({
        success: false,
        message: "PDF payment initialization failed.",
      });
    }

    payments.set(reference, {
      reference,
      type: "pdf",
      pdfId,
      email: normalizeEmail(email),
      amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      paymentRequired: true,
      reference,
      pdfId,
      pdfTitle: pdf.title,
      amountGHS: pdf.priceGHS,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "PDF payment could not be initialized.",
    });
  }
});

/* ============================================================
   PAYMENT VERIFICATION
   ============================================================ */

app.get("/api/payments/verify/:reference", async (req, res) => {
  try {
    const reference = req.params.reference;

    const payment = payments.get(reference);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment reference not found.",
      });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message: "Payment system is not configured.",
      });
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed.",
      });
    }

    if (data.data?.status === "success") {
      payment.status = "paid";
      payment.paidAt = new Date().toISOString();

      if (payment.type === "course") {
        const enrollmentId = makeId("ENROLL");

        courseEnrollments.set(enrollmentId, {
          enrollmentId,
          courseId: payment.courseId,
          email: payment.email,
          reference,
          enrolledAt: new Date().toISOString(),
          progress: 0,
          completed: false,
        });
      }

      return res.json({
        success: true,
        paid: true,
        type: payment.type,
        pdfId: payment.pdfId || null,
        courseId: payment.courseId || null,
        reference,
      });
    }

    res.json({
      success: true,
      paid: false,
      status: data.data?.status || "pending",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Payment verification failed.",
    });
  }
});

/* ============================================================
   PDF DOWNLOAD ACCESS
   ============================================================ */

app.get("/api/pdfs/:id/download-access", (req, res) => {
  const pdf = findPdf(req.params.id);

  if (!pdf) {
    return res.status(404).json({
      success: false,
      message: "PDF not found.",
    });
  }

  const email = req.headers["x-user-email"];

  if (isCreator(email)) {
    return res.json({
      success: true,
      allowed: true,
      reason: "creator",
    });
  }

  const reference = req.headers["x-payment-reference"];

  if (!reference) {
    return res.json({
      success: true,
      allowed: false,
      reason: "payment-required",
      priceGHS: pdf.priceGHS,
    });
  }

  const payment = payments.get(reference);

  if (
    payment &&
    payment.type === "pdf" &&
    payment.status === "paid" &&
    payment.pdfId === pdf.id &&
    payment.email === normalizeEmail(email)
  ) {
    return res.json({
      success: true,
      allowed: true,
      reason: "paid",
      pdfId: pdf.id,
    });
  }

  res.json({
    success: true,
    allowed: false,
    reason: "payment-not-verified",
  });
});

/* ============================================================
   COURSE ENROLLMENT STATUS
   ============================================================ */

app.get("/api/courses/:id/access", (req, res) => {
  const email = normalizeEmail(req.headers["x-user-email"]);

  if (isCreator(email)) {
    return res.json({
      success: true,
      access: true,
      reason: "creator",
      progress: 100,
    });
  }

  const enrollment = [...courseEnrollments.values()].find(
    (item) =>
      item.courseId === req.params.id &&
      item.email === email
  );

  if (!enrollment) {
    return res.json({
      success: true,
      access: false,
      reason: "payment-required",
    });
  }

  res.json({
    success: true,
    access: true,
    reason: "enrolled",
    progress: enrollment.progress,
    completed: enrollment.completed,
  });
});

/* ============================================================
   UPDATE COURSE PROGRESS
   ============================================================ */

app.post("/api/courses/:id/progress", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const progress = Math.max(
    0,
    Math.min(100, Number(req.body.progress || 0))
  );

  if (isCreator(email)) {
    return res.json({
      success: true,
      progress,
      completed: progress >= 100,
      creator: true,
    });
  }

  const enrollment = [...courseEnrollments.values()].find(
    (item) =>
      item.courseId === req.params.id &&
      item.email === email
  );

  if (!enrollment) {
    return res.status(403).json({
      success: false,
      message: "Course access required.",
    });
  }

  enrollment.progress = progress;
  enrollment.completed = progress >= 100;

  res.json({
    success: true,
    progress: enrollment.progress,
    completed: enrollment.completed,
  });
});

/* ============================================================
   CERTIFICATE ISSUE
   ============================================================ */

app.post("/api/certificates/issue", (req, res) => {
  const {
    email,
    learnerName,
    courseId,
  } = req.body;

  if (!email || !learnerName || !courseId) {
    return res.status(400).json({
      success: false,
      message: "learnerName, email and courseId are required.",
    });
  }

  const course = findCourse(courseId);

  if (!course) {
    return res.status(404).json({
      success: false,
      message: "Course not found.",
    });
  }

  const creator = isCreator(email);

  if (!creator) {
    const enrollment = [...courseEnrollments.values()].find(
      (item) =>
        item.courseId === courseId &&
        item.email === normalizeEmail(email) &&
        item.completed === true
    );

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message:
          "Complete the course before requesting your certificate.",
      });
    }
  }

  const certificateId = makeId("CERT");

  const certificate = {
    certificateId,
    learnerName,
    email: normalizeEmail(email),
    courseId,
    courseName: course.title,
    issuer: "PASSCOGH-MODOO",
    type: "Certificate of Completion",
    issuedAt: new Date().toISOString(),
    status: "VALID",
  };

  certificates.set(certificateId, certificate);

  res.json({
    success: true,
    certificate,
  });
});

/* ============================================================
   CERTIFICATE VERIFICATION
   ============================================================ */

app.get("/api/certificates/verify/:id", (req, res) => {
  const certificate = certificates.get(req.params.id);

  if (!certificate) {
    return res.status(404).json({
      success: true,
      valid: false,
      message: "Certificate not found.",
    });
  }

  res.json({
    success: true,
    valid: certificate.status === "VALID",
    certificate,
  });
});

/* ============================================================
   CREATOR ACCESS
   ============================================================ */

app.get("/api/creator/access", (req, res) => {
  const email = req.headers["x-user-email"];

  res.json({
    success: true,
    creator: isCreator(email),
    access: isCreator(email)
      ? {
          pdfReading: "FREE",
          pdfDownloads: "FREE",
          courses: "FREE",
          certificates: "FREE",
          advertisements: false,
          adminFeatures: true,
        }
      : null,
  });
});

/* ============================================================
   COPYRIGHT POLICY
   ============================================================ */

app.get("/api/copyright", (req, res) => {
  res.json({
    success: true,
    owner: "PASSCOGH-MODOO",
    statement:
      "Educational materials published by PASSCOGH-MODOO are protected by copyright unless otherwise stated.",
    onlineReading:
      "Online reading may be provided free according to the platform's access rules.",
    downloads:
      "Downloads are controlled through the platform's payment and access system.",
    redistribution:
      "Unauthorized redistribution or commercial resale of protected PASSCOGH-MODOO materials is prohibited.",
  });
});

/* ============================================================
   ADVERTISEMENT SETTINGS
   ============================================================ */

app.get("/api/ads/settings", (req, res) => {
  const email = req.headers["x-user-email"];

  res.json({
    success: true,
    enabled: !isCreator(email),
    intervalMinutes: isCreator(email) ? null : 15,
    placement: "FREE_READING",
  });
});

/* ============================================================
   404
   ============================================================ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found.",
    path: req.path,
  });
});

/* ============================================================
   ERROR HANDLER
   ============================================================ */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

/* ============================================================
   START SERVER
   ============================================================ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `PASSCOGH-MODOO backend running on port ${PORT}`
  );
});
