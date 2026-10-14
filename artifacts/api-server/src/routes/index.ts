import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dfsRouter from "./dfs";
import membershipRouter from "./membership";
import takesRouter from "./takes";
import feedbackRouter from "./feedback";
import modelProjectionsRouter from "./model-projections";
import evaluationsRouter from "./evaluations";
import matchupReportsRouter from "./matchup-reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(membershipRouter);
router.use(dfsRouter);
router.use(takesRouter);
router.use(feedbackRouter);
router.use(modelProjectionsRouter);
router.use(evaluationsRouter);
router.use(matchupReportsRouter);

export default router;
