PASSCOGH-MODOO — verified curriculum backend
This backend separates official curriculum sources from PASSCOGH-MODOO's own explanatory notes and practice questions.
Official curriculum source
NaCCA's official Secondary Education Curriculum page: https://nacca.gov.gh/secondary-education-curriculum/
The registry in data/curriculum/official-registry.json records the subject list and the official direct PDF URLs that have been verified from official/source evidence.
Important publishing rule
Do NOT label generated notes as "NaCCA official notes". Do NOT label generated questions as "real WASSCE past questions". A WASSCE question must be independently checked against an authorised/source copy before being labelled real.
Backend
Node 20+
Express
PostgreSQL
JWT authentication
bcrypt password hashing
Helmet
CORS allow-list
rate limiting
request validation
student progress
quiz scoring
admin content endpoints
curriculum source registry
health/readiness checks
Deployment
GitHub Pages hosts your static frontend; it does not run this backend.
Use a Node hosting service for this folder. Build: npm install
Start: npm start
Then set the frontend API base URL to: https://YOUR-BACKEND-DOMAIN/api
Database
Run: npm install npm run db:migrate npm run db:seed npm start
See docs/DEPLOYMENT.md.
