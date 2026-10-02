import { Router, type IRouter } from "express";
import blueFilesRouter from "./blue-files";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(blueFilesRouter);

export default router;
