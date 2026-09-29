# Assumptions

Calls made without asking, because the answer was reasonable and waiting would have
cost more than being wrong. Each is one line: question → decision → reason. Overrule
any of them and the code follows.

- [2026-09-29] How does the first teacher account come to exist on a fresh install? → Admin adds a teacher by phone + name (`POST /api/admin/teachers`); if the phone already belongs to a student, the admin is offered a promotion (`PATCH /api/admin/users/{id}/role`) → the admin mockup has an "O'qituvchi qo'shish" button, login is passwordless (phone + Telegram OTP), and without it prod has no teachers at all.
- [2026-09-29] Who publishes the official (`public`) catalog? → Admins only, from an admin "Kontent" section that reuses the teacher content editor; teachers still cannot self-grant `public` → a fresh install otherwise shows teacherless students an empty catalog, and the admin mockup lists Kontent in its nav.
- [2026-09-29] Does publishing a module publish its tasks? → Yes: false→true on the module publishes every draft task in it, and a task created inside a module inherits the module's state; the per-task toggle stays → the editor has no task-level publish control, so every teacher-authored task stayed a draft forever and never reached a student.
- [2026-09-29] Which answers may a teacher see? → Answers by students in the teacher's groups (any question, including the official catalog) plus answers to the teacher's own questions → a class practising the official catalog otherwise gives its teacher an empty queue, gradebook and analytics.
- [2026-09-29] Can a teacher grant Premium? → Yes, for students in the teacher's own groups; admins for anyone → the legacy product allowed it, the student-facing copy already promises it, and teacher-granted premium is the documented regression to protect.
- [2026-09-29] Deleting a task or module → soft delete that never removes student answers or grades → every FK into users/questions cascades, and a student's history is not the teacher's to destroy.
