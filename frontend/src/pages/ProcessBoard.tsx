import { useMemo } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import ProcessTimeline from '../components/common/ProcessTimeline';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { dueSamples, formatDate } from '../utils/degree';
import { buildStockMap, formatKg, roundKg, STOCK_EPS, type HerbStock } from '../utils/stock';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessBatch } from '../types/process-batch';
import type { SampleExpiry } from '../types/retain-sample';

const { Title, Paragraph, Text } = Typography;

interface PendingHerbRow {
  herb: HerbMaterial;
  stock: HerbStock;
}

/** 首页：待炮制药材余量与留样到期提示 */
export default function ProcessBoard() {
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const samples = useSampleStore((s) => s.samples);

  /** 药材批次核销情况（锁定记录继续占用，未锁定记录改动/撤销后随记录重算） */
  const stockMap = useMemo(() => buildStockMap(herbs, batches), [herbs, batches]);
  /** 首页待炮制量：全部药材批次余量合计 */
  const pendingKg = useMemo(() => roundKg(herbs.reduce((sum, herb) => sum + Math.max(0, stockMap.get(herb.id)?.remainingKg ?? 0), 0)), [herbs, stockMap]);
  const pendingHerbs = useMemo(
    () =>
      herbs
        .filter((herb) => (stockMap.get(herb.id)?.remainingKg ?? 0) > STOCK_EPS)
        .map((herb) => ({ herb, stock: stockMap.get(herb.id)! }))
        .sort((a, b) => b.stock.remainingKg - a.stock.remainingKg),
    [herbs, stockMap],
  );
  const exhaustedCount = useMemo(() => Array.from(stockMap.values()).filter((stock) => stock.exhausted).length, [stockMap]);
  const pendingRecords = useMemo(() => batches.filter((b) => !b.locked), [batches]);
  const due = useMemo(() => dueSamples(samples, 30), [samples]);
  const degreeCount = useMemo(() => {
    return batches.reduce(
      (acc, b) => {
        acc[b.degree] += 1;
        return acc;
      },
      { 不及: 0, 适中: 0, 太过: 0 } as Record<ProcessBatch['degree'], number>,
    );
  }, [batches]);

  const avgYield = useMemo(() => {
    if (batches.length === 0) return 0;
    return Number((batches.reduce((sum, b) => sum + b.yieldRate, 0) / batches.length).toFixed(1));
  }, [batches]);

  const pendingColumns: TableColumnsType<PendingHerbRow> = [
    { title: '药材', width: 100, render: (_, row) => <Text strong>{row.herb.name}</Text> },
    { title: '批次号', width: 120, render: (_, row) => row.herb.batchNo },
    { title: '入库量(kg)', width: 100, align: 'right', render: (_, row) => formatKg(row.stock.feedKg) },
    { title: '已用(kg)', width: 90, align: 'right', render: (_, row) => <Text type="warning">{formatKg(row.stock.usedKg)}</Text> },
    {
      title: '余量(kg)',
      width: 100,
      align: 'right',
      render: (_, row) => <Text strong type="success">{formatKg(row.stock.remainingKg)}</Text>,
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (row.stock.usedKg > 0 ? <Tag color="blue">使用中</Tag> : <Tag>待投料</Tag>),
    },
    { title: '入库时间', width: 110, render: (_, row) => formatDate(row.herb.receivedAt) },
  ];

  const dueColumns: TableColumnsType<SampleExpiry> = [
    { title: '留样编号', width: 150, render: (_, row) => <Text strong>{row.sample.sampleNo}</Text> },
    { title: '柜位', width: 80, render: (_, row) => row.sample.cabinet },
    { title: '留样量(g)', width: 90, align: 'right', render: (_, row) => row.sample.amountG },
    { title: '到期日', width: 110, render: (_, row) => row.expireAt },
    {
      title: '剩余天数',
      width: 100,
      align: 'right',
      render: (_, row) => (
        <Text type={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 30 ? 'warning' : undefined}>
          {row.daysLeft < 0 ? `已过期 ${Math.abs(row.daysLeft)} 天` : `${row.daysLeft} 天`}
        </Text>
      ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.state === '已到期' ? 'red' : row.state === '临期' ? 'orange' : 'green'}>{row.state}</Tag>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        中草药炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        按投料量折算辅料、记录火候与得率、逐批判定炮制程度并管理留样观察。数据全部保存在浏览器本地（IndexedDB：
        gbherbprocess-db）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge
            label="待炮制量（余量合计）"
            value={formatKg(pendingKg)}
            unit="kg"
            status={pendingKg > 0 ? 'warning' : 'success'}
            hint={`${pendingHerbs.length} 个批次有余量，${exhaustedCount} 个批次已用完；未提交判定工序 ${pendingRecords.length} 批`}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="在册药材批次" value={herbs.length} unit="批" hint={`已用完 ${exhaustedCount} 批`} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="30 天内到期留样" value={due.length} unit="份" status={due.length > 0 ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="平均得率" value={avgYield} unit="%" status="success" hint={`适中 ${degreeCount['适中']} / 不及 ${degreeCount['不及']} / 太过 ${degreeCount['太过']}`} />
        </Col>
      </Row>

      {due.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`留样到期提醒：${due.length} 份留样已到期或将在 30 天内到期`}
          description={
            <Space wrap>
              {due.slice(0, 6).map((item) => (
                <Tag key={item.sample.id} color={item.daysLeft < 0 ? 'red' : 'orange'}>
                  {item.sample.sampleNo}（柜位 {item.sample.cabinet}
                  {item.daysLeft < 0 ? `，已过期 ${Math.abs(item.daysLeft)} 天` : `，剩 ${item.daysLeft} 天`}）
                </Tag>
              ))}
              <Link to="/samples">
                <Button size="small" type="link">
                  前往留样台账处理
                </Button>
              </Link>
            </Space>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card
            title={`待炮制药材批次 · 余量合计 ${formatKg(pendingKg)}kg`}
            size="small"
            extra={
              <Link to="/batches">
                <Button size="small" type="primary">
                  去工序记录台
                </Button>
              </Link>
            }
          >
            <Table
              rowKey={(row) => row.herb.id}
              size="small"
              columns={pendingColumns}
              dataSource={pendingHerbs}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 720 }}
              locale={{ emptyText: '所有药材批次均已用完，请先登记新批次' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="最近炮制工序" size="small" style={{ marginBottom: 16 }}>
            <ProcessTimeline batches={batches} herbs={herbs} methods={methods} limit={5} />
          </Card>
          <Card title="留样到期提示" size="small">
            <Table
              rowKey={(row) => row.sample.id}
              size="small"
              columns={dueColumns}
              dataSource={due.slice(0, 6)}
              pagination={false}
              locale={{ emptyText: '暂无临期或到期留样' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
