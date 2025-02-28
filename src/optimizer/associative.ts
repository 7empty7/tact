// This module includes rules involving associative rewrites of expressions

import { evalBinaryOp } from "../constEval";
import {
    AstBinaryOperation,
    AstExpression,
    AstOpBinary,
    AstValue,
    isValue,
} from "../grammar/ast";
import { Value } from "../types/types";
import { ExpressionTransformer, Rule } from "./types";
import {
    abs,
    checkIsBinaryOpNode,
    checkIsBinaryOp_NonValue_Value,
    checkIsBinaryOp_Value_NonValue,
    extractValue,
    makeBinaryExpression,
    makeValueExpression,
    sign,
} from "./util";

type transformationData = {
    op1_: AstBinaryOperation;
    val_: Value;
};

type Transform = {
    transform: (c1: Value, c2: Value) => transformationData;
    safetyCondition: (c1: Value, val_: Value) => boolean;
};

abstract class AssociativeRewriteRule extends Rule {
    // An entry (op, S) in the map means "operator op associates with all operators in set S",
    // mathematically: all op2 \in S. (a op b) op2 c = a op (b op2 c)
    private associativeOps: Map<AstBinaryOperation, Set<AstBinaryOperation>>;

    // This set contains all operators that commute.
    // Mathematically:
    // all op \in commutativeOps. a op b = b op a
    private commutativeOps: Set<AstBinaryOperation>;

    constructor() {
        super();

        // + associates with these on the right:
        // i.e., all op \in additiveAssoc. (a + b) op c = a + (b op c)
        const additiveAssoc: Set<AstBinaryOperation> = new Set(["+", "-"]);

        // * associates with these on the right:
        const multiplicativeAssoc: Set<AstBinaryOperation> = new Set([
            "*",
            "<<",
        ]);

        // Division / does not associate with any on the right

        // Modulus % does not associate with any on the right

        // TODO: shifts, bitwise integer operators, boolean operators

        this.associativeOps = new Map([
            ["+", additiveAssoc],
            ["*", multiplicativeAssoc],
        ]);

        this.commutativeOps = new Set(
            ["+", "*", "!=", "==", "&&", "||"], // TODO: bitwise integer operators
        );
    }

    public areAssociative(
        op1: AstBinaryOperation,
        op2: AstBinaryOperation,
    ): boolean {
        if (this.associativeOps.has(op1)) {
            const rightOperators = this.associativeOps.get(op1)!;
            return rightOperators.has(op2);
        } else {
            return false;
        }
    }

    public isCommutative(op: AstBinaryOperation): boolean {
        return this.commutativeOps.has(op);
    }
}

abstract class AllowableOpRule extends AssociativeRewriteRule {
    private allowedOps: Set<AstBinaryOperation>;

    constructor() {
        super();

        this.allowedOps = new Set(
            // Recall that integer operators +,-,*,/,% are not safe with this rule, because
            // there is a risk that they will not preserve overflows in the unknown operands.
            ["&&", "||"], // TODO: check bitwise integer operators
        );
    }

    public isAllowedOp(op: AstBinaryOperation): boolean {
        return this.allowedOps.has(op);
    }

    public areAllowedOps(op: AstBinaryOperation[]): boolean {
        return op.reduce(
            (prev, curr) => prev && this.allowedOps.has(curr),
            true,
        );
    }
}

export class AssociativeRule1 extends AllowableOpRule {
    public applyRule(
        ast: AstExpression,
        optimizer: ExpressionTransformer,
    ): AstExpression {
        if (checkIsBinaryOpNode(ast)) {
            const topLevelNode = ast as AstOpBinary;
            if (
                checkIsBinaryOp_NonValue_Value(topLevelNode.left) &&
                checkIsBinaryOp_NonValue_Value(topLevelNode.right)
            ) {
                // The tree has this form:
                // (x1 op1 c1) op (x2 op2 c2)
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = leftTree.left;
                const c1 = leftTree.right as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree.left;
                const c2 = rightTree.right as AstValue;
                const op2 = rightTree.op;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op1 and op associate
                // op and op2 associate
                // op commutes
                if (
                    this.areAllowedOps([op1, op, op2]) &&
                    this.areAssociative(op1, op) &&
                    this.areAssociative(op, op2) &&
                    this.isCommutative(op)
                ) {
                    // Agglutinate the constants and compute their final value
                    try {
                        // If an error occurs, we abandon the simplification
                        const val = evalBinaryOp(
                            op2,
                            extractValue(c1),
                            extractValue(c2),
                        );

                        // The final expression is
                        // (x1 op1 x2) op val

                        // Because we are joining x1 and x2,
                        // there is further opportunity of simplification,
                        // So, we ask the evaluator to apply all the rules in the subtree.
                        const newLeft = optimizer.applyRules(
                            makeBinaryExpression(op1, x1, x2),
                        );
                        const newRight = makeValueExpression(val);
                        return makeBinaryExpression(op, newLeft, newRight);
                    } catch (e) {
                        // Do nothing: will exit rule without modifying tree
                    }
                }
            } else if (
                checkIsBinaryOp_NonValue_Value(topLevelNode.left) &&
                checkIsBinaryOp_Value_NonValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (x1 op1 c1) op (c2 op2 x2)
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = leftTree.left;
                const c1 = leftTree.right as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree.right;
                const c2 = rightTree.left as AstValue;
                const op2 = rightTree.op;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op1 and op associate
                // op and op2 associate
                if (
                    this.areAllowedOps([op1, op, op2]) &&
                    this.areAssociative(op1, op) &&
                    this.areAssociative(op, op2)
                ) {
                    // Agglutinate the constants and compute their final value
                    try {
                        // If an error occurs, we abandon the simplification
                        const val = evalBinaryOp(
                            op,
                            extractValue(c1),
                            extractValue(c2),
                        );

                        // The current expression could be either
                        // x1 op1 (val op2 x2) or
                        // (x1 op1 val) op2 x2  <--- we choose this form.
                        // Other rules will attempt to extract the constant outside the expression.

                        // Because we are joining x1 and val,
                        // there is further opportunity of simplification,
                        // So, we ask the evaluator to apply all the rules in the subtree.
                        const newValNode = makeValueExpression(val);
                        const newLeft = optimizer.applyRules(
                            makeBinaryExpression(op1, x1, newValNode),
                        );
                        return makeBinaryExpression(op2, newLeft, x2);
                    } catch (e) {
                        // Do nothing: will exit rule without modifying tree
                    }
                }
            } else if (
                checkIsBinaryOp_Value_NonValue(topLevelNode.left) &&
                checkIsBinaryOp_NonValue_Value(topLevelNode.right)
            ) {
                // The tree has this form:
                // (c1 op1 x1) op (x2 op2 c2)
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = leftTree.right;
                const c1 = leftTree.left as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree.left;
                const c2 = rightTree.right as AstValue;
                const op2 = rightTree.op;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op and op1 associate
                // op2 and op associate
                // op commutes
                if (
                    this.areAllowedOps([op1, op, op2]) &&
                    this.areAssociative(op, op1) &&
                    this.areAssociative(op2, op) &&
                    this.isCommutative(op)
                ) {
                    // Agglutinate the constants and compute their final value
                    try {
                        // If an error occurs, we abandon the simplification
                        const val = evalBinaryOp(
                            op,
                            extractValue(c2),
                            extractValue(c1),
                        );

                        // The current expression could be either
                        // x2 op2 (val op1 x1) or
                        // (x2 op2 val) op1 x1  <--- we choose this form.
                        // Other rules will attempt to extract the constant outside the expression.

                        // Because we are joining x2 and val,
                        // there is further opportunity of simplification,
                        // So, we ask the evaluator to apply all the rules in the subtree.
                        const newValNode = makeValueExpression(val);
                        const newLeft = optimizer.applyRules(
                            makeBinaryExpression(op2, x2, newValNode),
                        );
                        return makeBinaryExpression(op1, newLeft, x1);
                    } catch (e) {
                        // Do nothing: will exit rule without modifying tree
                    }
                }
            } else if (
                checkIsBinaryOp_Value_NonValue(topLevelNode.left) &&
                checkIsBinaryOp_Value_NonValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (c1 op1 x1) op (c2 op2 x2)
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = leftTree.right;
                const c1 = leftTree.left as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree.right;
                const c2 = rightTree.left as AstValue;
                const op2 = rightTree.op;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op1 and op associate
                // op and op2 associate
                // op commutes
                if (
                    this.areAllowedOps([op1, op, op2]) &&
                    this.areAssociative(op1, op) &&
                    this.areAssociative(op, op2) &&
                    this.isCommutative(op)
                ) {
                    // Agglutinate the constants and compute their final value
                    try {
                        // If an error occurs, we abandon the simplification
                        const val = evalBinaryOp(
                            op1,
                            extractValue(c1),
                            extractValue(c2),
                        );

                        // The final expression is
                        // val op (x1 op2 x2)

                        // Because we are joining x1 and x2,
                        // there is further opportunity of simplification,
                        // So, we ask the evaluator to apply all the rules in the subtree.
                        const newRight = optimizer.applyRules(
                            makeBinaryExpression(op2, x1, x2),
                        );
                        const newLeft = makeValueExpression(val);
                        return makeBinaryExpression(op, newLeft, newRight);
                    } catch (e) {
                        // Do nothing: will exit rule without modifying tree
                    }
                }
            }
        }

        // If execution reaches here, it means that the rule could not be applied fully
        // so, we return the original tree
        return ast;
    }
}

export class AssociativeRule2 extends AllowableOpRule {
    public applyRule(
        ast: AstExpression,
        optimizer: ExpressionTransformer,
    ): AstExpression {
        if (checkIsBinaryOpNode(ast)) {
            const topLevelNode = ast as AstOpBinary;
            if (
                checkIsBinaryOp_NonValue_Value(topLevelNode.left) &&
                !isValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (x1 op1 c1) op x2
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right;

                const x1 = leftTree.left;
                const c1 = leftTree.right as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op1 and op associate
                // op commutes
                if (
                    this.areAllowedOps([op1, op]) &&
                    this.areAssociative(op1, op) &&
                    this.isCommutative(op)
                ) {
                    // The final expression is
                    // (x1 op1 x2) op c1

                    // Because we are joining x1 and x2,
                    // there is further opportunity of simplification,
                    // So, we ask the evaluator to apply all the rules in the subtree.
                    const newLeft = optimizer.applyRules(
                        makeBinaryExpression(op1, x1, x2),
                    );
                    return makeBinaryExpression(op, newLeft, c1);
                }
            } else if (
                checkIsBinaryOp_Value_NonValue(topLevelNode.left) &&
                !isValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (c1 op1 x1) op x2
                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right;

                const x1 = leftTree.right;
                const c1 = leftTree.left as AstValue;
                const op1 = leftTree.op;

                const x2 = rightTree;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op1 and op associate
                if (
                    this.areAllowedOps([op1, op]) &&
                    this.areAssociative(op1, op)
                ) {
                    // The final expression is
                    // c1 op1 (x1 op x2)

                    // Because we are joining x1 and x2,
                    // there is further opportunity of simplification,
                    // So, we ask the evaluator to apply all the rules in the subtree.
                    const newRight = optimizer.applyRules(
                        makeBinaryExpression(op, x1, x2),
                    );
                    return makeBinaryExpression(op1, c1, newRight);
                }
            } else if (
                !isValue(topLevelNode.left) &&
                checkIsBinaryOp_NonValue_Value(topLevelNode.right)
            ) {
                // The tree has this form:
                // x2 op (x1 op1 c1)
                const leftTree = topLevelNode.left;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = rightTree.left;
                const c1 = rightTree.right as AstValue;
                const op1 = rightTree.op;

                const x2 = leftTree;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op and op1 associate
                if (
                    this.areAllowedOps([op, op1]) &&
                    this.areAssociative(op, op1)
                ) {
                    // The final expression is
                    // (x2 op x1) op1 c1

                    // Because we are joining x1 and x2,
                    // there is further opportunity of simplification,
                    // So, we ask the evaluator to apply all the rules in the subtree.
                    const newLeft = optimizer.applyRules(
                        makeBinaryExpression(op, x2, x1),
                    );
                    return makeBinaryExpression(op1, newLeft, c1);
                }
            } else if (
                !isValue(topLevelNode.left) &&
                checkIsBinaryOp_Value_NonValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // x2 op (c1 op1 x1)
                const leftTree = topLevelNode.left;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = rightTree.right;
                const c1 = rightTree.left as AstValue;
                const op1 = rightTree.op;

                const x2 = leftTree;

                const op = topLevelNode.op;

                // Check that:
                // the operators are allowed
                // op and op1 associate
                // op is commutative
                if (
                    this.areAllowedOps([op, op1]) &&
                    this.areAssociative(op, op1) &&
                    this.isCommutative(op)
                ) {
                    // The final expression is
                    // c1 op (x2 op1 x1)

                    // Because we are joining x1 and x2,
                    // there is further opportunity of simplification,
                    // So, we ask the evaluator to apply all the rules in the subtree.
                    const newRight = optimizer.applyRules(
                        makeBinaryExpression(op1, x2, x1),
                    );
                    return makeBinaryExpression(op, c1, newRight);
                }
            }
        }

        // If execution reaches here, it means that the rule could not be applied fully
        // so, we return the original tree
        return ast;
    }
}

function ensureInt(val: Value): bigint {
    if (typeof val !== "bigint") {
        throw new Error(`integer expected`);
    }
    return val;
}

export class AssociativeRule3 extends Rule {
    private leftAssocTransforms: Map<
        AstBinaryOperation,
        Map<AstBinaryOperation, Transform>
    >;
    private rightAssocTransforms: Map<
        AstBinaryOperation,
        Map<AstBinaryOperation, Transform>
    >;
    private rightCommuteTransforms: Map<
        AstBinaryOperation,
        Map<AstBinaryOperation, Transform>
    >;
    private leftCommuteTransforms: Map<
        AstBinaryOperation,
        Map<AstBinaryOperation, Transform>
    >;

    // Some standard safety conditions that repeat a lot.

    // Safety condition:
    // c1 != 0 ==> sign(c1) === sign(val_) && abs(c1) <= abs(val_)
    private standardAdditiveCondition: (c1: bigint, val_: bigint) => boolean = (
        c1,
        val_,
    ) => {
        if (c1 === 0n) {
            return true;
        }
        return sign(c1) === sign(val_) && abs(c1) <= abs(val_);
    };

    // Safety condition:
    // c1 != 0 ==> sign(c1) === sign(val_) && abs(c1) <= abs(val_)
    // c1 == 0 ==> val_ >= 0
    private standardAdditiveWithZeroCondition: (
        c1: bigint,
        val_: bigint,
    ) => boolean = (c1, val_) => {
        if (c1 === 0n) {
            return val_ >= 0n;
        }
        return sign(c1) === sign(val_) && abs(c1) <= abs(val_);
    };

    // Safety condition:
    // c1 != 0 && sign(c1) == sign(val_) ==> abs(c1) <= abs(val_)
    // c1 != 0 && sign(c1) != sign(val_) ==> abs(c1) < abs(val_)
    // c1 != 0 ==> val_ != 0
    private standardMultiplicativeCondition: (
        c1: bigint,
        val_: bigint,
    ) => boolean = (c1, val_) => {
        if (c1 === 0n) {
            return true;
        }
        // At this point, c1 != 0
        // hence, val_ must be non-zero as
        // required by the safety condition
        if (val_ === 0n) {
            return false;
        }
        // At this point, both c1 and val_ are non-zero
        if (sign(c1) === sign(val_)) {
            return abs(c1) <= abs(val_);
        } else {
            return abs(c1) < abs(val_);
        }
    };

    public constructor() {
        super();

        // First, we consider expressions of the form: (x1 op1 c1) op c2.

        // The following maps correspond to the transformation: x1 op1 (c1_ op_ c2_)_
        // for each pair of operators op1, op.
        // Here, we will denote c1_ op_ c2_ as val,
        // and (c1_ op_ c2_)_ as val_

        // op1 = +

        // This map stores all possibilities for op and the corresponding transformations for c1, c2 and val.
        const plusLeftAssocOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: (x1 + c1) + c2
                        transform: (c1, c2) => {
                            // final expression: x1 + (c1 + c2)
                            const res = evalBinaryOp("+", c1, c2);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: (x1 + c1) - c2
                        transform: (c1, c2) => {
                            // final expression: x1 + (c1 - c2)
                            const res = evalBinaryOp("-", c1, c2);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],
            ]);

        // op1 = -

        const minusLeftAssocOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: (x1 - c1) + c2
                        transform: (c1, c2) => {
                            // final expression x1 - (c1 - c2)
                            const res = evalBinaryOp("-", c1, c2);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: (x1 - c1) - c2
                        transform: (c1, c2) => {
                            // final expression x1 - (c1 + c2)
                            const res = evalBinaryOp("+", c1, c2);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],
            ]);

        // op1 = *

        const multiplyLeftAssocOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "*",
                    {
                        // original expression: (x1 * c1) * c2
                        transform: (c1, c2) => {
                            // final expression x1 * (c1 * c2)
                            const res = evalBinaryOp("*", c1, c2);
                            return { op1_: "*", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardMultiplicativeCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],
            ]);

        this.leftAssocTransforms = new Map([
            ["+", plusLeftAssocOperators],
            ["-", minusLeftAssocOperators],
            ["*", multiplyLeftAssocOperators],
        ]);

        // Now consider expressions of the form: c2 op (c1 op1 x1).

        // The following maps correspond to the transformation: (c2_ op_ c1_)_ op1 x1
        // for each pair of operators op1, op.
        // Here, we will denote c2_ op_ c1_ as val,
        // and (c2_ op_ c1_)_ as val_

        // op = +

        const plusRightAssocOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: c2 + (c1 + x1)
                        transform: (c1, c2) => {
                            // final expression (c2 + c1) + x1
                            const res = evalBinaryOp("+", c2, c1);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: c2 + (c1 - x1)
                        transform: (c1, c2) => {
                            // final expression (c2 + c1) - x1
                            const res = evalBinaryOp("+", c2, c1);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveWithZeroCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],
            ]);

        // op = -

        // Expressions of the form c2 - (c1 op1 x1) (for op1 \in {-, +}) cannot be simplified
        // without violating overflow preservation.
        // I am currently building a proof of this.

        // op = *

        const multiplyRightAssocOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "*",
                    {
                        // original expression: c2 * (c1 * x1)
                        transform: (c1, c2) => {
                            // final expression (c2 * c1) * x1
                            const res = evalBinaryOp("*", c2, c1);
                            return { op1_: "*", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardMultiplicativeCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],
            ]);

        this.rightAssocTransforms = new Map([
            ["+", plusRightAssocOperators],
            ["*", multiplyRightAssocOperators],
        ]);

        // Now consider expressions of the form: c2 op (x1 op1 c1).

        // The following maps correspond to the transformation: x1 op1 (c2_ op_ c1_)_
        // for each pair of operators op1, op.
        // Here, we will denote c2_ op_ c1_ as val,
        // and (c2_ op_ c1_)_ as val_

        // op = +

        const plusRightCommuteOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: c2 + (x1 + c1)
                        transform: (c1, c2) => {
                            // final expression x1 + (c2 + c1)
                            const res = evalBinaryOp("+", c2, c1);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: c2 + (x1 - c1)
                        transform: (c1, c2) => {
                            // final expression x1 - (c1 - c2)
                            const res = evalBinaryOp("-", c1, c2);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],
            ]);

        // op = -

        // Expressions of the form c2 - (x1 op1 c1) (for op1 \in {-, +}) cannot be simplified
        // without violating overflow preservation.
        // I am currently building a proof of this.

        // op = *

        const multiplyRightCommuteOperators: Map<
            AstBinaryOperation,
            Transform
        > = new Map([
            [
                "*",
                {
                    // original expression: c2 * (x1 * c1)
                    transform: (c1, c2) => {
                        // Final expression x1 * (c2 * c1)
                        const res = evalBinaryOp("*", c2, c1);
                        return { op1_: "*", val_: res };
                    },
                    safetyCondition: (c1, val_) => {
                        const n1 = ensureInt(c1);
                        const res = ensureInt(val_);
                        return this.standardMultiplicativeCondition(n1, res);
                    },
                },
            ],
        ]);

        this.rightCommuteTransforms = new Map([
            ["+", plusRightCommuteOperators],
            ["*", multiplyRightCommuteOperators],
        ]);

        // Now consider expressions of the form: (c1 op1 x1) op c2.

        // The following maps correspond to the transformation: x1 op1 (c1_ op_ c2_)_ op1 x1
        // for each pair of operators op1, op.

        // op1 = +

        const plusLeftCommuteOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: (c1 + x1) + c2
                        transform: (c1, c2) => {
                            // Final expression (c1 + c2) + x1
                            const res = evalBinaryOp("+", c1, c2);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: (c1 + x1) - c2
                        transform: (c1, c2) => {
                            // Final expression (c1 - c2) + x1
                            const res = evalBinaryOp("-", c1, c2);
                            return { op1_: "+", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveCondition(n1, res);
                        },
                    },
                ],
            ]);

        // op1 = -

        const minusLeftCommuteOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "+",
                    {
                        // original expression: (c1 - x1) + c2
                        transform: (c1, c2) => {
                            // Final expression (c1 + c2) - x1
                            const res = evalBinaryOp("+", c1, c2);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveWithZeroCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],

                [
                    "-",
                    {
                        // original expression: (c1 - x1) - c2
                        transform: (c1, c2) => {
                            // Final expression (c1 - c2) - x1
                            const res = evalBinaryOp("-", c1, c2);
                            return { op1_: "-", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardAdditiveWithZeroCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],
            ]);

        // op1 = *

        const multiplyLeftCommuteOperators: Map<AstBinaryOperation, Transform> =
            new Map([
                [
                    "*",
                    {
                        // original expression: (c1 * x1) * c2
                        transform: (c1, c2) => {
                            // Final expression (c1 * c2) * x1
                            const res = evalBinaryOp("*", c1, c2);
                            return { op1_: "*", val_: res };
                        },
                        safetyCondition: (c1, val_) => {
                            const n1 = ensureInt(c1);
                            const res = ensureInt(val_);
                            return this.standardMultiplicativeCondition(
                                n1,
                                res,
                            );
                        },
                    },
                ],
            ]);

        this.leftCommuteTransforms = new Map([
            ["+", plusLeftCommuteOperators],
            ["-", minusLeftCommuteOperators],
            ["*", multiplyLeftCommuteOperators],
        ]);
    }

    private lookupTransform(
        keyOp1: AstBinaryOperation,
        keyOp2: AstBinaryOperation,
        transforms: Map<AstBinaryOperation, Map<AstBinaryOperation, Transform>>,
    ): Transform | undefined {
        if (transforms.has(keyOp1)) {
            const intermediateMap = transforms.get(keyOp1)!;
            if (intermediateMap.has(keyOp2)) {
                return intermediateMap.get(keyOp2)!;
            }
        }
        return undefined;
    }

    protected getLeftAssociativityTransform(
        keyOp1: AstBinaryOperation,
        keyOp2: AstBinaryOperation,
    ): Transform | undefined {
        return this.lookupTransform(keyOp1, keyOp2, this.leftAssocTransforms);
    }

    protected getRightAssociativityTransform(
        keyOp1: AstBinaryOperation,
        keyOp2: AstBinaryOperation,
    ): Transform | undefined {
        return this.lookupTransform(keyOp1, keyOp2, this.rightAssocTransforms);
    }

    protected getLeftCommutativityTransform(
        keyOp1: AstBinaryOperation,
        keyOp2: AstBinaryOperation,
    ): Transform | undefined {
        return this.lookupTransform(keyOp1, keyOp2, this.leftCommuteTransforms);
    }

    protected getRightCommutativityTransform(
        keyOp1: AstBinaryOperation,
        keyOp2: AstBinaryOperation,
    ): Transform | undefined {
        return this.lookupTransform(
            keyOp1,
            keyOp2,
            this.rightCommuteTransforms,
        );
    }

    public applyRule(
        ast: AstExpression,
        optimizer: ExpressionTransformer,
    ): AstExpression {
        if (checkIsBinaryOpNode(ast)) {
            const topLevelNode = ast as AstOpBinary;
            if (
                checkIsBinaryOp_NonValue_Value(topLevelNode.left) &&
                isValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (x1 op1 c1) op c2

                // we transform it into:
                // x1 op1_ (c1_ op_ c2_)_

                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstValue;

                const x1 = leftTree.left;
                const c1 = extractValue(leftTree.right as AstValue);
                const op1 = leftTree.op;

                const c2 = extractValue(rightTree);

                const op = topLevelNode.op;

                try {
                    const transform = this.getLeftAssociativityTransform(
                        op1,
                        op,
                    )!;
                    const data = transform.transform(c1, c2);

                    const op1_ = data.op1_;
                    const val_ = data.val_;

                    // check the safety conditions

                    if (transform.safetyCondition(c1, val_)) {
                        // The final expression is
                        // x1 op1_ val_

                        const newConstant = makeValueExpression(val_);
                        // Since the tree is simpler now, there is further
                        // opportunity for simplification that was missed
                        // previously
                        return optimizer.applyRules(
                            makeBinaryExpression(op1_, x1, newConstant),
                        );
                    }
                } catch (e) {
                    // Do nothing: will exit rule without modifying tree
                }
            } else if (
                checkIsBinaryOp_Value_NonValue(topLevelNode.left) &&
                isValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // (c1 op1 x1) op c2

                // we transform it into:
                // (c1_ op_ c2_)_ op1_ x1

                const leftTree = topLevelNode.left as AstOpBinary;
                const rightTree = topLevelNode.right as AstValue;

                const x1 = leftTree.right;
                const c1 = extractValue(leftTree.left as AstValue);
                const op1 = leftTree.op;

                const c2 = extractValue(rightTree);

                const op = topLevelNode.op;

                try {
                    const transform = this.getLeftCommutativityTransform(
                        op1,
                        op,
                    )!;
                    const data = transform.transform(c1, c2);

                    const op1_ = data.op1_;
                    const val_ = data.val_;

                    // Check safety conditions

                    if (transform.safetyCondition(c1, val_)) {
                        // The final expression will be
                        // val_ op1_ x1

                        const newConstant = makeValueExpression(val_);
                        // Since the tree is simpler now, there is further
                        // opportunity for simplification that was missed
                        // previously
                        return optimizer.applyRules(
                            makeBinaryExpression(op1_, newConstant, x1),
                        );
                    }
                } catch (e) {
                    // Do nothing: will exit rule without modifying tree
                }
            } else if (
                isValue(topLevelNode.left) &&
                checkIsBinaryOp_NonValue_Value(topLevelNode.right)
            ) {
                // The tree has this form:
                // c2 op (x1 op1 c1)

                // we transform it into:
                // x1 op1_ (c2_ op_ c1_)_

                const leftTree = topLevelNode.left as AstValue;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = rightTree.left;
                const c1 = extractValue(rightTree.right as AstValue);
                const op1 = rightTree.op;

                const c2 = extractValue(leftTree);

                const op = topLevelNode.op;

                try {
                    const transform = this.getRightCommutativityTransform(
                        op,
                        op1,
                    )!;
                    const data = transform.transform(c1, c2);

                    const op1_ = data.op1_;
                    const val_ = data.val_;

                    // check the safety conditions
                    if (transform.safetyCondition(c1, val_)) {
                        // The final expression is
                        // x1 op1_ val_

                        const newConstant = makeValueExpression(val_);
                        // Since the tree is simpler now, there is further
                        // opportunity for simplification that was missed
                        // previously
                        return optimizer.applyRules(
                            makeBinaryExpression(op1_, x1, newConstant),
                        );
                    }
                } catch (e) {
                    // Do nothing: will exit rule without modifying tree
                }
            } else if (
                isValue(topLevelNode.left) &&
                checkIsBinaryOp_Value_NonValue(topLevelNode.right)
            ) {
                // The tree has this form:
                // c2 op (c1 op1 x1)

                // (c2_ op_ c1_)_ op1_ x1

                const leftTree = topLevelNode.left as AstValue;
                const rightTree = topLevelNode.right as AstOpBinary;

                const x1 = rightTree.right;
                const c1 = extractValue(rightTree.left as AstValue);
                const op1 = rightTree.op;

                const c2 = extractValue(leftTree);

                const op = topLevelNode.op;

                try {
                    const transform = this.getRightAssociativityTransform(
                        op,
                        op1,
                    )!;
                    const data = transform.transform(c1, c2);

                    const op1_ = data.op1_;
                    const val_ = data.val_;

                    // check safety conditions
                    if (transform.safetyCondition(c1, val_)) {
                        // The final expression is
                        // val_ op1_ x1

                        const newConstant = makeValueExpression(val_);
                        // Since the tree is simpler now, there is further
                        // opportunity for simplification that was missed
                        // previously
                        return optimizer.applyRules(
                            makeBinaryExpression(op1_, newConstant, x1),
                        );
                    }
                } catch (e) {
                    // Do nothing: will exit rule without modifying tree
                }
            }
        }

        // If execution reaches here, it means that the rule could not be applied fully
        // so, we return the original tree
        return ast;
    }
}
