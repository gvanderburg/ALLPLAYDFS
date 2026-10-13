import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dfsRouter from "./dfs";
import membershipRouter from "./membership";

const router: IRouter = Router();

router.use(healthRouter);
router.use(membershipRouter);
router.use(dfsRouter);

export default router;
