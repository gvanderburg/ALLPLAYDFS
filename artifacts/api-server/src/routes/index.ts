import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dfsRouter from "./dfs";
import membershipRouter from "./membership";
import takesRouter from "./takes";
import modelProjectionsRouter from "./model-projections";

const router: IRouter = Router();

router.use(healthRouter);
router.use(membershipRouter);
router.use(dfsRouter);
router.use(takesRouter);
router.use(modelProjectionsRouter);

export default router;
