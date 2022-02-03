import Container from '../components/Container'
import Head from 'next/head'
import Swap from './exchange/smart-swap/[[...tokens]]'

export default function Dashboard() {
  return Swap();
  // return (
  //   <Container id="dashboard-page" className="py-4 md:py-8 lg:py-12" maxWidth="2xl">
  //     <Head>
  //       <title>Dashboard | SmartSwap</title>
  //       <meta name="description" content="Tango" />
  //     </Head>
  //   </Container>
  // )
}
